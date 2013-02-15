
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

	var db = require('mongojs').connect(process.env.MONGOHQ_URL)

	db.collection('records').ensureIndex({ grabbedBy : 1 }, { background : true })
	db.collection('records').ensureIndex({ availableToGrabAt : 1, time : -1 }, { background : true })

	db.createCollection('logs', {capped : true, size : 10000}, function () {})
	logError = function (err, notes) {
	    console.log('error: ' + (err.stack || err))
		console.log('notes: ' + _.json(notes))
		db.collection('logs').insert({ error : '' + (err.stack || err), notes : notes })
	}

	var express = require('express')
	var app = express.createServer()

	app.use(express.cookieParser())
	app.use(function (req, res, next) {
		_.run(function () {
			req.body = _.consume(req)
		    next()
		})
	})

	var MongoStore = require('connect-mongo')(express)
	app.use(express.session({
		secret : process.env.SESSION_SECRET,
		cookie : { maxAge : 24 * 60 * 60 * 1000 },
		store : new MongoStore({
			url : process.env.MONGOHQ_URL,
			clear_interval : 3600
		})
	}))

	require('./login.js')(db, app, process.env.HOST, process.env.ODESK_API_KEY, process.env.ODESK_API_SECRET)

	app.get('/', function (req, res) {
		if (!req.user)
			res.redirect('/login')
		else
			res.sendfile('./index.html')
	})

	function ungrab(u) {
		var p1 = _.promiseErr()
		var p2 = _.promiseErr()
		db.collection('records').update({ grabbedBy : u._id, availableToGrabAt : { $exists : true } }, { $set : { availableToGrabAt : 0 }, $unset : { grabbedBy : null } }, { multi : true }, p1.set)
		db.collection('records').update({ grabbedBy : u._id, availableToGrabAt : { $exists : false } }, { $unset : { grabbedBy : null } }, { multi : true }, p2.set)
		p1.get()
		p2.get()
	}

	app.all('/rpc', require('./rpc.js')({
		getVersion : function () {
			return 1
		},

		getUser : function (arg, req, res) {
			return req.user
		},

		grabBatch : function (arg, req, res) {
			var u = req.user
			if (!u) throw new Error("must be logged in")
			var p = _.promiseErr()

			if (!arg) {
				db.collection('records').find({ grabbedBy : u._id }).sort({ time : -1 }, p.set)
				var r = p.get()
				if (r.length > 0) return r
			} else {
				ungrab(u)
			}

			for (var i = 0; i < 10; i++) {
				// find stuff to grab
				db.collection('records').find({ availableToGrabAt : { $lt : _.time() } }).sort({ availableToGrabAt : 1, time : -1 }).limit(10, p.set)
				var r = p.get()

				// grab them
				db.collection('records').update({
					_id : { $in : _.map(r, function (e) { return e._id }) },
					availableToGrabAt : { $lt : _.time() }
				}, { $set : {
					availableToGrabAt : _.time() + 1000 * 60 * 60,
					grabbedBy : u._id
				}}, { multi : true }, p.set)
				p.get()

				// find what we ended up grabbing
				db.collection('records').find({ grabbedBy : u._id }).sort({ time : -1 }, p.set)
				var r = p.get()
				if (r.length > 0) return r
			}
			return []
		},

		submit : function (arg, req, res) {
			var u = req.user
			if (!u) throw new Error("must be logged in")
			if (!arg.task.match(/^.{0,64}$/)) throw new Error("bad input: " + arg.task)
			if (!(arg.accept == true || arg.accept == false || arg.accept == null)) throw new Error("bad input: " + arg.accept)

			if (arg.accept == null) {
				var post = {
					$unset : {
						accept : null,
						doneBy : null,
						doneAt : null
					},
					$set : {
						availableToGrabAt : _.time() + 1000 * 60 * 60,
					}
				}
			} else {
				var post = {
					$unset : {
						availableToGrabAt : null
					},
					$set : {
						accept : arg.accept,
						doneBy : u._id,
						doneAt : _.time()
					}
				}
			}

			db.collection('records').update({
				_id : arg.task,
				grabbedBy : u._id
			}, post)
		}
	}))

	app.use(function(err, req, res, next) {
		logError(err, {
			session : req.session,
			user : req.user
		})
		next(err)
	})

	app.listen(process.env.PORT, function() {
		console.log("go to " + process.env.HOST)
	})

})
