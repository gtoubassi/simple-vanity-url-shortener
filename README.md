# Simple Url Shortener

This describes how to create a dirt simple vanity url shortener using AWS Lambda for serving, Google Forms for the UI (i.e. creating new vanity urls), and Google Sheets as the backend.  This document can be found via my personal url shortener at [garrick.fun/howto](http://garrick.fun/howto)

### Step 1: The "Backend"

First create a Google Sheet to store your mappings.  The easiest way to do this is first go to forms.google.com, and create a new form.  The form should have 3 fields: **Vanity Path**, **Destination Url**, and **Extra**.  The first two map a vanity url path like `hn` to `http://news.ycombinator.com`.  The last one is a lame hack because there is no way to make a form private to only a small number of users (like yourself).  So its really a password field and you can add validation on the form to make sure a specific secret string is used to allow the form to be submitted.  This will keep random people from polluting your mappings.  You can decide how worried you are about this ([learn more](https://www.bettercloud.com/monitor/the-academy/restrict-access-to-google-forms/)).

Now that you have your "UI", you can fill out the form and hit submit to create your first URL mapping.  Try this by associating the path "new" with the form URL itself.  Now go to "responses" and click the green Google Sheet icon to materialize the responses into a Sheet.  That Sheet is now your backend database!

### Step 2: Service Account and API access to the Sheet

We need to give our AWS Lambda function access to the sheet.  We'll be using the NodeJS module [google-spreadsheet](https://www.npmjs.com/package/google-spreadsheet).  google-spreadsheet has two ways to access a Sheet.  The first option requires no auth but requires publishing your sheet to the web so it is publicly visible.  So you'd either be comfortable with "security by obscurity" or acknowledge that there is no interesting info in your link database.  This method is described [here](https://medium.com/perfektio/google-sheets-aws-lambda-json-backend-d5e67ab4f660).

We will raise the bar just slightly by keeping our Sheet private, and sharing it with a "Service Account" that our AWS Lambda function will use (via a private key) to access the sheet.

So lets create a service account and give it access to the Google Sheets API.

1. Go to the [Google Developers Console](https://console.developers.google.com) and create a new project from the dropdown in the upper left.  It takes a few seconds to create it, but once its created make sure to switch to it in the aforementioned dropdown.
2. Go to "Enable APIs and Services" which is a link in the upper middle of the screen when you switch to the new project.  Search for the "Google Sheets API", and enable it.
3. Now the left nav should show you are in "APIs & Services > Google Sheets API".  Select the Credentials menu in the left nav, go to "manage service accounts", then click "Create Service Account".  Give it a name like "redirector", and hit create.  It doesn't need a role.  But make sure to download the key (as JSON) by clicking "Create Key".  Make sure not to check in this file or lose it.

Now you can share the Sheet (view only) with the Service Account (via it's email address).  This will give the Service Account access to the Sheet via the API.

### Step 3: Create the AWS Lambda

We now will create an AWS Lambda function to perform the redirect.

1. First clone this repo, and download the dependencies by running `npm install --omit=dev`
2. From within the directory, create a zip file of the resources with `zip -r ../lambda-src.zip index.mjs package.json package-lock.json node_modules`
3. Go to the [lambda section](http://console.aws.amazon.com/lambda) of the AWS console.  And create a new lambda function via the **Create function** button.  Select the "Author from Scratch", give it a name, and choose the **Node.js 24.x** runtime.  No permissions are needed.
4. In the function configuration page (which you should end up on), in the **Code** section, upload the zip file via **Upload from > .zip file**.  The handler should be `index.handler` (Lambda finds `index.mjs` automatically).  The code is an ES module because `google-spreadsheet` v5 depends on ESM-only packages that the Lambda runtime won't `require()`.
5. Under **Configuration > General configuration**, bump the timeout to 10 seconds and memory to 256 MB.  The defaults (3 seconds, 128 MB) are too tight for a cold start that authenticates with Google and reads the sheet.
6. In the **Environment Variables** section, you'll need to specify three env variables that the script depends on:
    1. **SERVICE_ACCOUNT_EMAIL** is the email address of the service account from the downloaded json (`client_email` field)
    2. **SERVICE_ACCOUNT_PK** is the `private key` field from the json file.  Its important to make sure the newlines are represented as \n strings, because they will be turned into newlines by the lambda.  So you can literally just grab the value from the json (without the double quotes).
    3. **SHEET_ID** is the ID of the Google Sheet for your backend (that the form dumps into).  It will be something like `1nuTiZnCC2dnn2lHY5_M1fg3bM1OMXTj71Iz5h4`.
    4. [Optional] **NO_MATCH_REDIR_URL** is the url to redirect in the case of a miss.  It is recommended that you actually redirect to the form creation url so that the easiest way to add a new vanity url is to just go to garrick.fun/mynewurl and let it redirect you to the form.  And the cool thing is if you cook that URL the right way you can have it prepopulate the vanity path into the form (e.g. 'mynewurl' will already be in the form!).  The way to do this is go to your form and from the triple-dot menu in the upper right, select "Get pre-filled link".  Fill the vanity path with **SHORTURL**, and click the "Get link" button.  The redirector will replace SHORTURL with whatever path was specified on the url.
    5. [Optional] **CACHE_TTL_SECONDS** controls how long the vanity url mappings are cached in memory (default 300).  The sheet is only re-read when the cache expires, so a burst of requests (bots find everything eventually) doesn't blow through the Google Sheets API's per-minute read quota.  If a re-read fails, the last good copy keeps being served.  This also means a newly added vanity url can take up to 5 minutes to start working.

### Step 4: Get a domain and a certificate

Buy a cool domain name like `lotsa.fish` (available at the time of this writing!) and put its DNS on [Cloudflare](https://cloudflare.com) (the free plan is fine).

Then request a certificate for the domain in the AWS Certificate Manager (ACM), in the same region as your lambda.  Choose DNS validation, and add the CNAME record ACM gives you to your Cloudflare DNS as **DNS only** (grey cloud, not proxied).  Leave that record in place forever; ACM uses it to auto-renew the certificate.

### Step 5: Put your Lambda behind a load balancer

At the top of the lambda function configuration page, click the **Add trigger** button and select the "Application Load Balancer" option.  For the load balancer name, click the little blue link above the field to create a new one.  Give it a name, and make sure it is "internet facing".  Configure a single **HTTPS/443** listener using the ACM certificate from step 4 (the default security policy is fine).  You don't need an HTTP/80 listener; Cloudflare will handle http to https redirects.  Choose a new security group.  For Target Group create a new target group with a "target type" of lambda, and select your lambda.  When you are done it will take awhile for the new LB to go from "provisioning" to "active" (10 minutes or more).

Finally, lock the load balancer's security group down so it only accepts **inbound TCP 443 from [Cloudflare's IP ranges](https://www.cloudflare.com/ips/)** (both the IPv4 and IPv6 lists).  Otherwise internet-wide scanners hit your load balancer directly, and every one of those requests invokes the lambda and reads your sheet.  Cloudflare rarely changes these ranges, but if the site ever starts timing out for no apparent reason, check them first.

### Step 6: Point your domain at the load balancer via Cloudflare

In Cloudflare:

1. **DNS:** add a `CNAME` record for `@` (the root of your domain) pointing to your load balancer's DNS name (something like `YourLoadBalancerName-2072409351.us-east-1.elb.amazonaws.com`), with **Proxied** (orange cloud) turned on.  Cloudflare allows a CNAME at the root.
2. **SSL/TLS:** set the encryption mode to **Full (strict)**.  This makes Cloudflare talk to your load balancer over HTTPS on port 443 and verify its certificate, which works because the ACM certificate is for your domain.  (Don't use "Flexible": it makes Cloudflare connect over plain HTTP on port 80, which the load balancer doesn't listen on.)
3. **Optional:** turn on **Security > Bots > Bot Fight Mode** to challenge known bots, and **SSL/TLS > Edge Certificates > Always Use HTTPS**.

Now when you go to `https://lotsa.fish/new` you should end up at the form, and you can start creating vanity urls.

Note: an earlier version of this guide used registrar "domain forwarding" to redirect your domain to the raw `http://...elb.amazonaws.com` url.  Don't do that.  Modern browsers upgrade that redirect to https, which fails because the load balancer's certificate is for your domain, not the elb hostname, so links just spin.  Proxying through Cloudflare as described above keeps the browser on `https://yourdomain` the whole time.


