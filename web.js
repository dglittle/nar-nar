
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
	db.collection('records').ensureIndex({ 'status.action' : 1, availableToGrabAt : 1, time : -1 }, { background : true })

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
			auto_reconnect : true,
			clear_interval : 3600
		})
	}))

	require('./login.js')(db, app, process.env.HOST, process.env.ODESK_API_KEY, process.env.ODESK_API_SECRET)

	function requireClearnance(user, level) {
		if (!(user.clearance >= level))
			throw new Error("sorry " + user._id + ", you must be given permission to access this site.")
	}

	app.all('*', function (req, res, next) {
		if (!req.user) {
			res.redirect('/login')
		} else {
			requireClearnance(req.user, 1)
			next()
		}
	})

	app.get('/', function (req, res) {
		res.sendfile('./index.html')
	})

	app.get('/admin', function (req, res) {
		requireClearnance(req.user, 2)
		res.sendfile('./admin.html')
	})

	function ungrab(u) {
		var p = _.promiseErr()
		db.collection('records').update({ grabbedBy : u._id, availableToGrabAt : { $lt : _.time() + 1000 * 60 * 60 } }, { $set : { availableToGrabAt : 0 }, $unset : { grabbedBy : null } }, { multi : true }, p.set)
		p.get()
		db.collection('records').update({ grabbedBy : u._id }, { $unset : { grabbedBy : null } }, { multi : true }, p.set)
		p.get()
	}

	app.all('/rpc', require('./rpc.js')({
		getVersion : function () {
			return 1
		},

		getUser : function (arg, req, res) {
			return req.user
		},

		setUser : function (arg, req, res) {
			var u = req.user
			var p = _.promiseErr()
			db.collection('users').update({ _id : u._id }, { $set : _.pick(arg, 'typeA', 'typeB') }, p.set)
			return p.get()
		},

		getUsers : function (arg, req, res) {
			var u = req.user
			requireClearnance(u, 2)

			var p = _.promiseErr()
			db.collection('users').find({}, p.set)
			return p.get()
		},

		setPermissions : function (arg, req, res) {
			var u = req.user
			requireClearnance(u, 2)

			var admins = _.makeSet(_.trim(arg.admins).split(/[,\s]/))
			var workers = _.makeSet(_.trim(arg.workers).split(/[,\s]/))

			var p = _.promiseErr()
			db.collection('users').find({}, p.set)
			_.each(p.get(), function (u) {
				if (_.has(admins, u._id)) {
					db.collection('users').update({ _id : u._id }, { $set : { clearance : 2 }}, p.set)
					p.get()
				} else if (_.has(workers, u._id)) {
					db.collection('users').update({ _id : u._id }, { $set : { clearance : 1 }}, p.set)
					p.get()
				} else {
					db.collection('users').update({ _id : u._id }, { $set : { clearance : 0 }}, p.set)
					p.get()
				}
			})
			_.each(admins, function (_, _id) {
				db.collection('users').update({ _id : _id }, { $set : { clearance : 2 }}, { upsert : true }, p.set)
				p.get()
			})
			_.each(_.setSub(workers, admins), function (_, _id) {
				db.collection('users').update({ _id : _id }, { $set : { clearance : 1 }}, { upsert : true }, p.set)
				p.get()
			})
		},

		getTaskCount : function (arg, req, res) {
			var ret = {}

			var p = _.promiseErr()
			db.collection('records').find({ 'status.action' : { $exists : false}, availableToGrabAt : { $lt : _.time() } }).count(p.set)
			ret.typeA = p.get()

			db.collection('records').find({ 'status.action' : 'warn', availableToGrabAt : { $lt : _.time() } }).count(p.set)
			ret.typeB = p.get()

			return ret
		},

		grabBatch : function (arg, req, res) {
			var u = req.user
			var p = _.promiseErr()
			if (arg.typeA == null) arg.typeA = u.typeA
			if (arg.typeB == null) arg.typeB = u.typeB

			if (!arg.forceNew) {
				db.collection('records').find({ grabbedBy : u._id }).sort({ time : -1 }, p.set)
				var r = p.get()
				if (r.length > 0) return r
			}

			ungrab(u)

			if (arg.typeA == false && arg.typeB == false)
				return []

			for (var i = 0; i < 10; i++) {
				// find stuff to grab
				var $or = []
				if (arg.typeA != false)
					$or.push({ 'status.action' : { $exists : false } })
				if (arg.typeB != false)
					$or.push({ 'status.action' : 'warn' })

				db.collection('records').find({ $or : $or, availableToGrabAt : { $lt : _.time() } }).sort({ 'status.action' : 1, availableToGrabAt : 1, time : -1 }).limit(10, p.set)
				var r = p.get()

				// grab them
				db.collection('records').update({
					_id : { $in : _.map(r, function (e) { return e._id }) },
					$or : $or,
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
			var task = arg
			if (task.status.action == 'warn')
				// set again since we don't trust the client's time
				task.status.warnUntil = _.time() + 1000 * 60 * 60 * 48

			var post = {
				$set : {
					status : task.status
				},
				$push : {
					history : {
						status : arg.status,
						by : u._id,
						at : _.time()
					}
				}
			}
			if (task.status.action == 'warn') {
				post.$set.availableToGrabAt = task.status.warnUntil
			} else if (task.status) {
				post.$unset = {}
				post.$unset.availableToGrabAt = null
			} else {
				post.$set.availableToGrabAt = _.time() + 1000 * 60 * 60
			}

			db.collection('records').update({
				_id : task._id,
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

	app.use(express.errorHandler({
		dumpExceptions: true,
		showStack: true
	}))

	app.listen(process.env.PORT, function() {
		console.log("go to " + process.env.HOST)
	})

})
