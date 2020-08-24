// variables
let hosts = {};
let errors = {};
let ipCache = {};
let redirects = {};

// constants
const REQUEST_FILTER_ALL = {urls: ["<all_urls>"]};
const REQUEST_FILTER_MAIN = {urls: ["<all_urls>"], types: ["main_frame"]};

// functions

let checkHosts = function () {
    for (let domain in hosts) {
        if (hosts[domain].expires < Date.now()) {
            if (hosts[domain].disabled) delete(hosts[domain]); // delete disabled domains when expired
            else if (hosts[domain].lastUsed > Date.now() - 604800000) updateIp(domain); // update expired domains used in the last week
        }
    }
};

let retrieveIp = function (domain, onSuccess) {
    console.log("Retrieving IP for " + domain);
    if (hosts[domain]) return onSuccess && onSuccess(hosts[domain].ip);
    return updateIp(domain, onSuccess);
   
};

let updateIp  = function (domain, onSuccess) {
    console.log("Updating IP for " + domain);
    let xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://dns.google.com/resolve?name=' + domain, true);
    xhr.onreadystatechange = function () {
        if (xhr.readyState == XMLHttpRequest.DONE && xhr.status == 200) {
            let data = JSON.parse(xhr.responseText);
            if (data.Answer) {
                for (let i = 0; i < data.Answer.length; i++) {
                    if (isIp(data.Answer[i].data)) {
                        let answer = data.Answer[i];
                        let ip = answer.data;
                        if (!hosts[domain]) hosts[domain] = {};
                        hosts[domain].ip = ip;
                        hosts[domain].expires = Date.now() + answer.TTL * 1000;
                        hosts[domain].updated = Date.now();
                        ipCache[ip] = domain;
                        storeHosts();
                        return onSuccess && onSuccess(ip);
                    }
                }
            }
        }
    };
    xhr.send();   
};

let hostFromUrl = function (url) {
    let matches = url.match(/\/\/(.+?)\//);
    return matches && matches[1];
};
let replaceHost = function (url, host) {
    return url.replace(/\/\/(.+?)\//, '//' + host + '/');
};

let isIp = function (host) {
    return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

let unblockTab = function (tab) {
    let url = tab.url;
    let domain = hostFromUrl(url);
    let tabId = tab.id;
    retrieveIp(domain, function (ip) {
        console.log("Retrieved IP for", domain, "->", ip);
        if (hosts[domain].disabled) {
            hosts[domain].disabled = false;
            storeHosts();
        }
        chrome.tabs.update(tabId, {url: redirects[tabId] && redirects[tabId].redirectUrl == url ? replaceHost(redirects[tabId].url, ip).replace(/^https/i, 'http') : 'http://' + ip + '/'});
    });
};

let updateIcon = function () {
    chrome.tabs.query({active: true}, function (tabs) {
        if (tabs && tabs[0]) updateIconForTab(tabs[0]);
    });
};

let updateIconForTab = function(tab) {
    if (/^http/i.test(tab.url)) {
        let host = hostFromUrl(tab.url);
        if (isIp(host)) {
            if (ipCache[host] && hosts[ipCache[host]]) {
                if (hosts[ipCache[host]].disabled) lockedIcon();
                else unlockedIcon();
            }
            else disabledIcon();
        }
        else lockedIcon();
    }
    else disabledIcon();
};

let unlockedIcon = function () {
    chrome.browserAction.setTitle({title: "Disable unblocker on this site."});
    chrome.browserAction.setIcon({path: "unlocked128.png"});
    chrome.browserAction.enable();
};
let lockedIcon = function () {
    chrome.browserAction.setTitle({title: "Unblock this site!"});
    chrome.browserAction.setIcon({path: "locked128.png"});
    chrome.browserAction.enable();
};
let disabledIcon = function () {
    chrome.browserAction.setTitle({title: "This site cannot be unblocked."});
    chrome.browserAction.setIcon({path: "locked128.png"});
    chrome.browserAction.disable();  
};

let storeHosts = function () {
    chrome.storage.sync.set({hosts: hosts});
};

// handlers

let onBeforeRequestHandler = function (details) {
    console.log("Request", details.url);
    // console.log("BeforeRequest", details.url, details);
    let domain = hostFromUrl(details.url);
    if (hosts[domain] && !hosts[domain].disabled) {
        let ip = hosts[domain].ip;
        ipCache[ip] = domain;
        let redirectUrl = replaceHost(details.url, ip);
        if (details.type == "main_frame") hosts[domain].lastUsed = Date.now();
        if (/^https/.test(redirectUrl) && !hosts[domain].forceHttps) {
            console.log("Trying http version.");
            redirectUrl = redirectUrl.replace(/^https/, 'http');
        }
        console.log("Redirecting from", details.url, "to", redirectUrl);
        return {redirectUrl: redirectUrl};
    }
};

let onBeforeSendHeadersHandler = function (details) {
    // console.log("BeforeSendHeaders", details.url, details);
    // console.log("Headers", details.url);
    let ip = hostFromUrl(details.url);
    if (ipCache[ip]) {
        let domain = ipCache[ip];
        // rewrite referer
        for (let i = 0; i < details.requestHeaders.length; i++) {
            if (details.requestHeaders[i].name == "Referer") {
                let refererIp = hostFromUrl(details.requestHeaders[i].value);
                if (refererIp == ip) {
                    // console.log("Replacing Referer:", domain);
                    details.requestHeaders[i].value = replaceHost(details.requestHeaders[i].value, domain);                        
                }
                break;
            }
        }
        // rewrite host 
        //console.log("Adding host to headers:", domain);
        details.requestHeaders.push({name: "Host", value: domain});
        return {requestHeaders: details.requestHeaders};
    }
};

let onBeforeRedirectHandler = function (details) {
    console.log("Redirect", details.url, details.redirectUrl);
    //console.log("BeforeRedirect", details.url, details.redirectUrl, details);
    if (redirects[details.tabId] && redirects[details.tabId].url == details.url && redirects[details.tabId].redirectUrl == details.redirectUrl) {
        let domain = hostFromUrl(details.redirectUrl);
        if (!isIp(domain)) {
            console.log("Detected circular redirect!");
            if (hosts[domain] && !hosts[domain].disabled) {
                hosts[domain].disabled = true; 
                alert("Error: This website redirects back from " + details.url + " to " + details.redirectUrl);
            }
        }
    }
    if (!/^https/.test(details.url) && /^https/.test(details.redirectUrl)) {
        let ip = hostFromUrl(details.url);
        let domain = ipCache[ip];
        if (domain) {
            console.log("This website is redirecting to https.");
            if (hosts[domain]) hosts[domain].forceHttps = true;
        }
    }
    redirects[details.tabId] = {url: details.url, redirectUrl: details.redirectUrl, time: Date.now()};
};

let onErrorOccurredHandler = function (details) {
    console.log("Error", details.url);
    //console.log("ErrorOccurred", details.url, details);
    if ((!errors[details.url] || errors[details.url] < Date.now() - 60000) && /^https:\/\//.test(details.url)  && !isIp(hostFromUrl(details.url))) {
        console.log("Redirecting to http version.");
        errors[details.url] = Date.now();
        chrome.tabs.update(details.tabId, {url: details.url.replace(/^https/, 'http')});
    }
};

// listeners
chrome.webRequest.onBeforeRequest.addListener(onBeforeRequestHandler, REQUEST_FILTER_ALL, ["blocking"]);
chrome.webRequest.onBeforeSendHeaders.addListener(onBeforeSendHeadersHandler, REQUEST_FILTER_ALL, ["blocking", "requestHeaders"]);
chrome.webRequest.onErrorOccurred.addListener(onErrorOccurredHandler, REQUEST_FILTER_MAIN);
chrome.webRequest.onBeforeRedirect.addListener(onBeforeRedirectHandler, REQUEST_FILTER_MAIN);

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    console.log('Message received from:', sender , ':', message);
    if ('blockedSite' in message) {
        let domain = hostFromUrl(sender.url);
        if (!hosts[domain] || !hosts[domain].disabled) unblockTab(sender.tab);
    }
});

chrome.browserAction.onClicked.addListener(function (tab) {
    let host = hostFromUrl(tab.url);
    if (isIp(host)) {
        let domain = ipCache[host];
        if (domain) {
            hosts[domain].disabled = true;
            storeHosts();
            chrome.tabs.update(tab.id, {url: replaceHost(tab.url, domain)});
        }
    }
    else {
        unblockTab(tab);
    }
});

chrome.tabs.onActivated.addListener(function (activeInfo) {
    // console.log('onActivated', activeInfo);
    updateIcon();
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    // console.log('onUpdated', changeInfo, tab);
    if (changeInfo.url && tab.active) updateIconForTab(tab);
});

chrome.alarms.onAlarm.addListener(function(alarm) {
    if (alarm.name === "checkHosts") {
        checkHosts();
    }
});

// calls

chrome.storage.sync.get(['hosts'], function (items) {
    console.log("Storage:", items);
    if (items.hosts) {
        hosts = items.hosts;
        for (let domain in hosts) {
            ipCache[hosts[domain].ip] = domain;
        }
        checkHosts();
    }
});

updateIcon();

chrome.alarms.create("checkHosts", {periodInMinutes: 60});
