const httpProxy = require('http-proxy');

class Proxy{
    constructor(){
        this.proxyServer = httpProxy.createProxyServer();
        this.proxyServer.on('error',function(err, req, res){
            res.writeHead(500, {
                'Content-Type': 'text/plain'
            });
            res.end('ERR: create proxyServer '+ err);
        });
    }
    web(req, res, target){
        this.proxyServer.web(req, res, { target: target ||'http://127.0.0.1' });
    }
}

module.exports = new Proxy();