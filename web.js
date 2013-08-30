
function defaultEnv(key, val) {
    if (!process.env[key])
        process.env[key] = val
}
defaultEnv("PORT", 5000)
defaultEnv("HOST", "http://localhost:5000")
defaultEnv("NODE_ENV", "production")

defaultEnv("OBO_BASE_URL", "https://example.com/user/")
defaultEnv("MONGOHQ_URL", "mongodb://localhost:27017/narnar")
defaultEnv("SESSION_SECRET", "blahblah")
defaultEnv("ODESK_API_KEY", "3f448b92c4aaf8918c0106bd164a1656")
defaultEnv("ODESK_API_SECRET", "e6a71b4f05467054")
defaultEnv("ADD_KEY", "7dhfywfjyrxhonizdfku3kuiuise23")

///

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

	var db = require('mongojs').connect(process.env.MONGOHQ_URL, ['records', 'users', 'history'])

	db.collection('records').ensureIndex({ grabbedBy : 1 }, { background : true })
	db.collection('records').ensureIndex({ 'status.action' : 1, availableToGrabAt : 1, time : -1 }, { background : true })

	db.createCollection('logs', {capped : true, size : 10000}, function () {})
	logError = function (err, notes) {
	    console.log('error: ' + (err.stack || err))
		console.log('notes: ' + _.json(notes))
		db.collection('logs').insert({ error : '' + (err.stack || err), notes : notes })
	}
	logSomething = function (something) {
		if (typeof(something) == 'string')
			something = { msg : something }
		db.collection('logs').insert(something)
	}

	var express = require('express')
	var app = express()

	app.use(express.static(__dirname + '/static'))

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

	app.all('/add', function (req, res) {
		_.run(function () {

			logSomething({ type : 'add', query : req.query })

			if (req.query.key != process.env.ADD_KEY) {
				if (req.query.key && req.query.key.length > 5 && process.env.ADD_KEY.indexOf(req.query.key) == 0) {
					// development key,
					// don't actually add it,
					// but say we did
					res.send("added, I swear!")
					return
				}
				throw new Error('wrong key')
			}
			var t = req.query.created_ts_gmt
			if (!t) {
				t = _.time()
			} else if (t.match(/^-?\d+$/)) {
				t = parseInt(t)
			} else {
				t = new Date(t).getTime()
			}
			if (!req.query.uid) throw new Error('uid required')
			if (!req.query.profile_key) throw new Error('profile_key required')
			var p = _.promise()
	        db.records.insert({
				_id : req.query.uid,
				profileKey : req.query.profile_key,
				time : t,
	            availableToGrabAt : 0
			}, p.set)
	        var e = p.get()
	        if (e) {
	            if (e.name == 'MongoError' && e.code == 11000) {
	                res.send("already exists")
	            } else {
	                throw e
	            }
	        } else {
	        	res.send("added")
	        }
	    })
	})

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

	function parallel(funcs) {
		var p = _.promise()
		var remaining = funcs.length
		_.each(funcs, function (f) {
			_.run(function () {
				f()
				remaining--
				if (remaining <= 0) p.set()
			})
		})
		if (remaining <= 0) p.set()
		p.get()
	}

	var odesk = require('node-odesk')

	function enrichBatch(r) {
		parallel(_.map(r, function (r) {
			return function () {
				try {
					if (!process.env.ODESK_USER_TOKEN) {
						var profile = _.wget('http://www.odesk.com/api/profiles/v1/providers/' + r.profileKey + '.json')
						profile = _.unJson(profile).profile
						r.usedAPI = false
					} else {
						var o = new odesk(process.env.ODESK_API_KEY, process.env.ODESK_API_SECRET)
						o.OAuth.accessToken = process.env.ODESK_USER_TOKEN
						o.OAuth.accessTokenSecret = process.env.ODESK_USER_TOKEN_SECRET
						
						var p = _.promiseErr()
						o.get('profiles/v1/providers/' + r.profileKey, p.set)
						var profile = p.get().profile
						r.usedAPI = true
					}
					if (!profile) throw "fail"
					r.username = r._id
					r.obo = process.env.OBO_BASE_URL + r._id
					r.name = profile.dev_full_name || profile.dev_short_name || null
					r.img = profile.dev_portrait_100 || null
					r.title = profile.dev_profile_title || null
					r.overview = profile.dev_blurb || null
				} catch (e) {
					var p = _.promiseErr()
					db.records.remove({ _id : r._id }, p.set)
					p.get()

					r.badTime = _.time()
					db.collection('bads').insert(r, p.set)
					p.get()
				}
			}
		}))
		return _.filter(r, function (r) { return r.username })
	}

	function recordEvent(u, msg, e) {
		e = e || {}
		e.msg = msg
		e.by = u._id
		e.at = _.time()
		db.collection('history').insert(e, function () {})
	}

	app.all('/rpc', require('./rpc.js')({
		getVersion : function () {
			return 3
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

			db.collection('records').find({ 'status.action' : 'idv', availableToGrabAt : { $lt : _.time() } }).count(p.set)
			ret.typeB = p.get()

			return ret
		},

		grabBatch : function (arg, req, res) {
			var u = req.user
			var p = _.promiseErr()
			if (arg.typeA == null) arg.typeA = u.typeA
			if (arg.typeB == null) arg.typeB = u.typeB

			if (arg.ungrab) {
				ungrab(u)
				recordEvent(u, 'released batch')
				return []
			}

			if (!arg.forceNew) {
				db.collection('records').find({ grabbedBy : u._id }).sort({ time : -1 }, p.set)
				var r = p.get()
				if (r.length > 0) {
					return enrichBatch(r)
				}
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
					$or.push({ 'status.action' : 'idv' })

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

				if (r.length > 0) {
					r = enrichBatch(r)
					recordEvent(u, 'grabbed batch', {
						batch : r
					})
					return r
				}
			}
			return []
		},

		submit : function (arg, req, res) {
			var u = req.user
			var task = arg
			if (task.status.action == 'idv')
				// set again since we don't trust the client's time
				task.status.warnUntil = _.time() + 1000 * 60 * 60 * 24 * 5

			var post = {
				$set : {
					status : task.status
				}
			}
			if (task.status.action == 'idv') {
				post.$set.availableToGrabAt = task.status.warnUntil
			} else if (task.status.action) {
				post.$unset = {}
				post.$unset.availableToGrabAt = null
			} else {
				post.$set.availableToGrabAt = _.time() + 1000 * 60 * 60
			}

			db.collection('records').update({
				_id : task._id,
				grabbedBy : u._id
			}, post)

			recordEvent(u, task.msg, { task : _.omit(task, 'msg') })
		}
	}))

	app.get(/\/report.*/, function (req, res) {
		requireClearnance(req.user, 2)
		_.run(function () {
			var p = _.promiseErr()

			function objectIdFromTime(timestamp) {
			    return require('mongojs').ObjectId(Math.floor(timestamp/1000).toString(16) + "0000000000000000")
			}

			var x = new Date(new Date().toDateString())
			var endTime = x.getTime() - (1000 * 60 * 60 * 24 * x.getDay())
			var startTime = endTime - (1000 * 60 * 60 * 24 * 7)

			db.collection('history').find({
				_id : {
					$gte : objectIdFromTime(startTime),
					$lt : objectIdFromTime(endTime)
				},
				'task.status.action' : { $exists : true }
			}).sort({ _id : -1 }, p.set)
			var xs = p.get()

			var dones = {}
			var counts = {}
			var reps = {}

			db.records.find({
				time : {
					$gte : startTime,
					$lt : endTime
				}
			}).count(p.set)
			counts.queued = p.get()

			_.each(xs, function (x) {
				if (dones[x.task._id]) return
				dones[x.task._id] = true

				if (!reps[x.by]) {
					reps[x.by] = {
						actionCount : 0,
						samples : []
					}
				}
				var rep = reps[x.by]
				if (Math.random() < (25 / (rep.actionCount + 1))) {
					var reasons = []
					for (var key in x.task.status) {
						if (key == 'action') continue
						reasons.push(key)
					}
					var info = {
						date_reviewed : "" + new Date(x.at),
						rep_who_reviewed : x.by,
						profile_image : x.task.img,
						profile_name : x.task.name,
						userID : x.task.username,
						profile_title : x.task.title,
						profile_overview : x.task.overview,
						action_taken : x.task.status.action,
						action_reasons : reasons.join(', ')
					}
					if (rep.samples.length < 25)
						rep.samples.push(info)
					else
						rep.samples[Math.floor(Math.random() * 25)] = info
				}
				rep.actionCount++

				for (var key in x.task.status) {
					var k = key
					if (k == 'action') k = x.task.status[k]
					if (!counts[k]) counts[k] = 0
					counts[k]++
				}
			})

	        function escapeCsv(s) {
	        	if (!s) return ''
	            if (s.match(/[,"\n]/))
	                return '"' + s.replace(/"/g, '""') + '"'
	            return s
	        }

			var csv = []
			_.each(counts, function (v, k) {
				csv.push(k + ',' + v + '\n')
			})
			csv.push('\n')
			csv.push('rep,actionCount\n')
			_.each(reps, function (rep, k) {
				csv.push(k + ',' + rep.actionCount + '\n')
			})
			csv.push('\n')
			csv.push('samples:\n')
			var headersPrinted = false
			_.each(reps, function (rep, k) {
				_.each(rep.samples, function (sample) {
					if (!headersPrinted) {
						csv.push(_.keys(sample).join(',') + '\n')
						headersPrinted = true
					}
					csv.push(_.map(_.values(sample), escapeCsv).join(',') + '\n')
				})
			})

			res.setHeader('Content-Type', 'text/csv');
			res.send(csv.join(''))
		})
	})

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
