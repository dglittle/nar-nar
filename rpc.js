// example request: [{func : "add", arg : [1, 2]}, {func : "sub", arg : [2, 1]}]

module.exports = function (funcs) {
    return function (req, res) {
        _.run(function () {
            var input = _.unJson(req.method.match(/post/i) ? req.body : _.unescapeUrl(req.url.match(/\?(.*)/)[1]))
            if (input instanceof Array) {
                var output = _.map(input, function (input) {
                    return funcs[input.func](input.arg, req, res)
                })
            } else {
                var output = funcs[input.func](input.arg, req, res)
            }
            var body = _.json(output) || "null"
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(body)
            })
            res.end(body)
        })
    }
}
