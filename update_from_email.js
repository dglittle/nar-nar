
function logError(err, notes) {
    console.log('error: ' + (err.stack || err))
    console.log('notes: ' + notes)
}

process.on('uncaughtException', function (err) {
    try {
        logError(err)
    } catch (e) {}
})

require('./u.js')
require('./nodeutil.js')
_.run(function () {
    var p = _.promiseErr()
    var p1 = _.promise()

    var Imap = require('imap')
    var imap = new Imap({
        user: process.env.GMAIL_USER,
        password: process.env.GMAIL_PASS,
        host: 'imap.gmail.com',
        port: 993,
        secure: true
    })

    imap.connect(p.set)
    p.get()

    imap.openBox('INBOX', false, p.set)
    var box = p.get()

    while (true) {

        // get email

        imap.search(['UNSEEN', ['SUBJECT', '[MQ-NAR]']], p.set)
        var res = p.get()
        if (res instanceof Array) res = res[0]
        if (!res) break

        imap.fetch(res, { headers: { parse: false }, body: true, cb: p1.set }, function () {})
        var fetch = p1.get()

        fetch.on('message', p1.set)
        var msg = p1.get()

        var bufs = []
        msg.on('data', function(chunk) {
            bufs.push(chunk)
        })
        msg.on('end', function() {
            p1.set(Buffer.concat(bufs))          
        })
        var buf = p1.get()

        var MailParser = require("mailparser").MailParser
        var mailparser = new MailParser()
        mailparser.on('end', p1.set)
        mailparser.write(buf)
        mailparser.end()
        var mo = p1.get()

        // parse csv

        function parseHyperlink(s) {
            return s = eval(s.match(/^=hyperlink\((.*)\)$/)[1])
        }
        var rows = require('./csv.js').parse('' + mo.attachments[0].content, '|', true)
        if (rows.length > 0 && !rows[0].created_ts_gmt) throw new Error('CSV PARSE ERROR!')
        var rows = _.map(rows, function (r) {
            return {
                time : new Date(r.created_ts_gmt).getTime(),
                username : r.uid,
                name : r.user_name,
                img : r.portraiturl ? parseHyperlink(r.portraiturl) : null,
                title : r.profiletitle || null,
                overview : r.profile_overview || null,
                obo : parseHyperlink(r.obo_link)
            }
        })

        // upload

        var db = require('mongojs').connect(process.env.MONGOHQ_URL)
        _.each(rows, function (d) {
            d._id = _.md5(d.username + d.name + d.img + d.title + d.overview)
            d.availableToGrabAt = 0
            db.collection('records').insert(d, p1.set)
            p1.get()
        })

        // finish with email

        imap.addFlags(msg.uid, '\\Seen', p.set)
        p.get()
    }

    process.exit(1)
})
