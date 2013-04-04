
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

    imap.search(['UNSEEN', ['SUBJECT', '[MQ-NAR]']], p.set)
    var res = p.get()
    if (res instanceof Array) res = res[0]
    if (!res) break

    console.log("processing an e-mail...")

    // mark it as seen here,
    // since for some reason doing it later will cause an error...
    // this is a hack, but using e-mail at all is a hack,
    // and this whole bit of code should be removed soon anyway
    imap.addFlags(msg.uid, '\\Seen', p.set)
    p.get()

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
                _.print("already there")
            } else {
                throw e
            }
        }
    })

    process.exit(1)
})
