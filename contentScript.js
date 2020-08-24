(function() {
    // console.log("Site Unblocker: detecting...");
    if (document.body.innerHTML.length < 600 && (
        /^Acesso bloqueado por /.test(document.title) ||
        /O site a que se pretende aceder encontra-se bloqueado/.test(document.body.innerHTML)
    )) {
        console.log("Site bloqueado! A obter IP...");
        chrome.runtime.sendMessage({'blockedSite': true});
    }
})();
