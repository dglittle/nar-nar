nar-nar
=======

environment variables to set

```
NODE_ENV=production

PORT=5000
HOST=http://localhost:5000
MONGOHQ_URL=mongodb://localhost:27017/test

SESSION_SECRET=doesnt_matter_locally
ODESK_API_KEY=do_not_check_into_github
ODESK_API_SECRET=do_not_check_into_github

GMAIL_USER=do_not_check_into_github
GMAIL_PASS=do_not_check_into_github

OBO_BASE_URL=part_of_obo_url_in_front_of_username
```

to run locally:

```
export KEY=VAL
export KEY=VAL
foreman start
```

===

to setup on heroku:

```
heroku create
heroku addons:add mongohq:small

git push heroku master

heroku config:set KEY=VAL
heroku config:set KEY=VAL

heroku ps:scale web=2

heroku addons:add scheduler:standard
heroku addons:open scheduler
	add "node cron.js" to run every 10 minutes

heroku open
```
