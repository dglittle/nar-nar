nar-nar
=======

to run locally:

```
export PORT=5000
export HOST=http://localhost:5000
export MONGOHQ_URL=mongodb://localhost:27017/test

export SESSION_SECRET=doesnt_matter_locally
export ODESK_API_KEY=do_not_check_into_github
export ODESK_API_SECRET=do_not_check_into_github

export GMAIL_USER=do_not_check_into_github
export GMAIL_PASS=do_not_check_into_github

foreman start
```

===

to setup on heroku:

```
heroku create
heroku addons:add mongohq:small

heroku config:set NODE_ENV=production
heroku config:set HOST=https://random-name-6789.herokuapp.com

heroku config:set SESSION_SECRET=do_not_check_into_github
heroku config:set ODESK_API_KEY=do_not_check_into_github
heroku config:set ODESK_API_SECRET=do_not_check_into_github

heroku config:set GMAIL_USER=do_not_check_into_github
heroku config:set GMAIL_PASS=do_not_check_into_github

git push heroku master
heroku open
heroku ps:scale web=2

heroku addons:add scheduler:standard
heroku addons:open scheduler
	add "node cron.js" to run every 10 minutes
```
