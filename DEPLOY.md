# Deploying Meridian to Render.com (Free)

## What you have
- `server.js` — the backend (fetches RSS, calls Claude, serves the site)
- `public/index.html` — the frontend (no key screen, just works)
- `package.json` — tells Render how to run it

## Step 1 — Put it on GitHub (free, 5 minutes)
1. Go to github.com and sign up free
2. Click the + button → "New repository"
3. Name it "meridian" → click "Create repository"
4. Click "uploading an existing file"
5. Upload ALL these files maintaining the folder structure:
   - server.js
   - package.json
   - public/index.html
6. Click "Commit changes"

## Step 2 — Deploy on Render (free, 5 minutes)
1. Go to render.com and sign up free (use your GitHub account)
2. Click "New" → "Web Service"
3. Connect your GitHub account and select your "meridian" repo
4. Fill in these settings:
   - Name: meridian
   - Runtime: Node
   - Build Command: (leave blank)
   - Start Command: node server.js
5. Click "Advanced" → "Add Environment Variable"
   - Key: ANTHROPIC_KEY
   - Value: (paste your sk-ant-... key here)
6. Click "Create Web Service"
7. Wait ~2 minutes — Render builds and deploys it
8. Your URL appears at the top: something like https://meridian.onrender.com

## Step 3 — Connect your domain (optional)
1. In Render, go to your service → Settings → Custom Domains
2. Add your domain (e.g. readmeridian.com)
3. Follow the DNS instructions to point your Namecheap domain to Render

## That's it!
- Site loads live RSS headlines from NYT, BBC, Reuters, Fox News, AP, WaPo, NPR, WSJ
- Claude synthesizes each story server-side
- Your API key is hidden — users just visit the site and it works
- Stories cache for 30 minutes so you don't burn API credits
