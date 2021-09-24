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

1. First clone this repo, and download the dependencies by running `npm install`
2. From within the directory, create a zip file of the resources with `zip -r ../lambda-src.zip *`
3. Go to the [lambda section](http://console.aws.amazon.com/lambda) of the AWS console.  And create a new lambda function via the **Create function** button.  Select the "Author from Scratch", and give it a name.  No permissions are needed.
4. In the function configuration page (which you should end up on), in the **Function Code** section, upload the zip file via the "code entry type" field.
5. In the **Environment Variables** section, you'll need to specify three env variables that the script depends on:
    1. **SERVICE_ACCOUNT_EMAIL** is the email address of the service account from the downloaded json (`client_email` field)
    2. **SERVICE_ACCOUNT_PK** is the `private key` field from the json file.  Its important to make sure the newlines are represented as \n strings, because they will be turned into newlines by the lambda.  So you can literally just grab the value from the json (without the double quotes).
    3. **SHEET_ID** is the ID of the Google Sheet for your backend (that the form dumps into).  It will be something like `1nuTiZnCC2dnn2lHY5_M1fg3bM1OMXTj71Iz5h4`.
    4. [Optional] **NO_MATCH_REDIR_URL** is the url to redirect in the case of a miss.  It is recommended that you actually redirect to the form creation url so that the easiest way to add a new vanity url is to just go to garrick.fun/mynewurl and let it redirect you to the form.  And the cool thing is if you cook that URL the right way you can have it prepopulate the vanity path into the form (e.g. 'mynewurl' will already be in the form!).  The way to do this is go to your form and from the triple-dot menu in the upper right, select "Get pre-filled link".  Fill the vanity path with **SHORTURL**, and click the "Get link" button.  The redirector will replace SHORTURL with whatever path was specified on the url.

### Step 4: Put your Lambda on the internet

We need to make the lambda available via http.  At the top of the lambda function configuration page, click the **Add trigger** button and select the "Application Load Balancer" option.  For the load balancer name, click the little blue link above the field to create a new one.  Give it a name, and make sure it is "internet facing".  The "listeners" section should be pre-filled in with HTTP/80.  Click next, then choose a new security group.  For Target Group create a new target group with a "target type" of lambda, and select your lambda.  When you are done it will take awhile for the new LB to go from "provisioning" to "active" (10 minutes or more).  But now if you go back to your lambda config page you will see the Application Load Balancer is there as a trigger.

When the application load balancer finally is provisioned you will be able to hit the url listed on its config (something like YourLoadBalancerName-20742898761.us-east-1.elb.amazonaws.com).  You should now be able to access the redirector by hitting YourLoadBalancerName-2072409351.us-east-1.elb.amazonaws.com/**new**, and it should take you to the form.

### Step 5: Custom Domain

Now you can buy a cool domain name like `lotsa.fish` (available at the time of this writing!), and using domain forwarding, have it forward (including the path!) over to your LB url.  Now when you go to `lotsa.fish/new` you can create new URLs.

### Step 6: Add HTTPS support

You will want to add HTTPS support given increasing demand for it from browsers (e.g. Safari won't follow http links for random domains).  To do this involves three steps:

1. **Add an HTTPS listener to our load balancer.**  First, go to the Load Balancer section of the aws console (search for load balancer and click the EC2 Load Balancer feature, not Lightsail).  You should see your load balancer in the list.  Select it and then select the "Listeners" tab.  You should see the HTTP/80 listener.  Add one for HTTPs.  You will need to supply a certificate.  I used the Amazon Certificate Manager (ACM) to create one on my domain (having to verify the domain from Google Domains by emitting a CNAME with a magic value).  You will also need to specify a security policy and you should just be able to use the default.
2. **Add an HTTPS trigger to our lambda function.**  Now you can go over to your lambda function configuration page, and click **Add trigger** and repeat the process described above in step 4 except this time, of course, specify HTTPS as your trigger.  I entered the host but left the path blank.
3. **If you are using domain forwarding, making sure HTTPS is forwarded.**  For example on Google Domains, you need to explicitly enable this, as described in [this support article](https://support.google.com/domains/answer/4522141?hl=en).


