const http   = require('http');
const path   = require('path');
const config = require('./config/default');
const fs     = require('fs');
const mime   = require('./mime');
const {URL}  = require('url');
const zlib   = require('zlib');


const c = require('child_process');


const hasTrailingSlash = url => url[url.length - 1] === '\\';

class StaticServer {
    constructor() {
        this.port          = config.port || 0;
        this.root          = config.root;
        this.indexPage     = config.indexPage;
        this.isOpenBrowser = config.isOpenBrowser || false //是否打开默认browser
        this.zipMatch      = config.zipMatch;
        this.maxAge        = config.maxAge
    }

    start() {
        const server = http.createServer((req, res) => {
            const pathName = path.join(this.root, path.normalize(req.url));
            this.routeHandler(pathName, req, res);
        });
        server.listen(this.port, err => {

            if (err) {
                console.error(err);
                console.info('Failed to start server');
            } else {
                this.port = server.address().port;
                console.info(`Server startd on port ${this.port}`);

                if (this.isOpenBrowser) {
                    try {
                        c.exec('start http://127.0.0.1:' + this.port);
                    } catch (e) {
                        console.log('Browser open fail', e);
                    }
                }

            }
        })
    }

    routeHandler(pathName, req, res) {
        fs.stat(pathName, (err, stat) => {
            console.log(req.url);
            if (!err) {
                const requestedPath = new URL(pathName).pathname;
                if (hasTrailingSlash(requestedPath) && stat.isDirectory()) {
                    this.respondDirectory(pathName, req, res);
                } else if (stat.isDirectory()) {
                    this.respondRedirect(req, res);
                } else {
                    this.respond(pathName, req, res);
                }
            } else {
                console.info('文件未找到',err);
                this.respondNotFile(req, res);
            }
        })
    }

    respond(pathName, req, res) {
        fs.stat(pathName, (err, stat) => {
            if (err) return this.respondError(req, res);

            this.setFreshHeaders(stat, res);
            this.respondFile(pathName, req, res);
        })
    }

    respondFile(pathName, req, res) {
        let readStream = fs.createReadStream(pathName);
        readStream.on('error', function (err) {//流错误处理
            console.trace();
            console.error("stack:", err.stack);
            console.error("The error raised was:", err);
        });
        res.setHeader('Content-Type', mime.lookup(pathName));
        if (this.hasCompress(pathName)) {
            readStream = this.compressHandler(readStream, req, res);
        }
        readStream.pipe(res);//管道
    }

    respondNotFile(req, res) {
        res.writeHead(404, {
            'Content-Type': 'text/html'
        });
        res.end(`<h1>Not Found</h1><p>The requested URL ${req.url} was not found on this server.</p>`);
    };


    /**
     * 处理目录
     * @param pathName
     * @param req
     * @param res
     */
    respondDirectory(pathName, req, res) {
        const indexPagePath = path.join(pathName, this.indexPage);
        //判断是否存在默认页面
        if (fs.existsSync(indexPagePath)) {
            this.respond(indexPagePath, req, res);
        } else {
            fs.readdir(pathName, (err, files) => {
                if (err) {
                    return this.respondError(res, err);
                }
                const requestPath = new URL(pathName).pathname;
                let content       = `<h1>Index of ${requestPath}</h1>`;
                files.forEach(file => {
                    let itemLink = path.join(req.url, file);
                    const stat   = fs.statSync(path.join(pathName, file));
                    if (stat && stat.isDirectory()) {
                        itemLink = path.join(itemLink, '/');
                    }
                    content += `<p><a href='${itemLink}'>${file}</a></p>`;
                });
                res.writeHead(200, {
                    'Content-Type': 'text/html'
                });
                res.end(content);
            });
        }
    }

    respondError(res, err) {
        res.writeHead(500);
        return res.end(err);
    }

    /**
     * 目录跳301
     * @param req
     * @param res
     */
    respondRedirect(req, res) {
        const location = req.url + '/';
        res.writeHead(301, {
            'Location'    : location,
            'Content-Type': 'text/html'
        });
        res.end(`Redirecting to <a href='${location}'>${location}</a>`);
    }

    /**
     * 处理压缩
     * @param readStream
     * @param req
     * @param res
     * @returns {*}
     */
    compressHandler(readStream, req, res) {
        const acceptEncoding = req.headers['accept-encoding'];
        if (!acceptEncoding || !acceptEncoding.match(/\b(gzip|deflate)\b/)) {//\b匹配边界
            return readStream;
        } else if (acceptEncoding.match(/\bgzip\b/)) {
            res.setHeader('Content-Encoding', 'gzip');
            return readStream.pipe(zlib.createGzip());
        } else if (acceptEncoding.match(/\bdeflate\b/)) {
            res.setHeader('Content-Encoding', 'deflate');
            return readStream.pipe(zlib.createDeflate());
        }

    }

    hasCompress(pathName) {
        return path.extname(pathName).match(this.zipMatch);
    }

    setFreshHeaders(stat, res) {
        const lastModified = stat.mtime.toUTCString();
        res.setHeader('Cache-Control', `public,max-age=${this.maxAge}`)
    }
}

module.exports = new StaticServer();