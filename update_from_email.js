
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

        console.log("processing an e-mail...")

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
                _id : r.uid,
                profileKey : r.profile_key,
                time : new Date(r.created_ts_gmt).getTime()
            }
        })

        // upload

        var db = require('mongojs').connect(process.env.MONGOHQ_URL)
        _.each(rows, function (d) {
            d.availableToGrabAt = 0

            db.collection('records').insert(d, p1.set)
            var e = p1.get()
            if (e) {
                if (e.name == 'MongoError' && e.code == 11000) {
                    // fine, it was already there
                } else {
                    throw e
                }
            }
        })

        // finish with email

        imap.addFlags(msg.uid, '\\Seen', p.set)
        p.get()
    }

    process.exit(1)
})
