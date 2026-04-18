const https = require('https');
const http = require('http');

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY || '';
const PORT = process.env.PORT || 3000;

// RSS feeds — left, center, right sources
const FEEDS = [
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',      lean: 'left',   name: 'NYT' },
  { url: 'https://feeds.washingtonpost.com/rss/national',                   lean: 'left',   name: 'WaPo' },
  { url: 'https://feeds.npr.org/1001/rss.xml',                              lean: 'left',   name: 'NPR' },
  { url: 'https://feeds.bbci.co.uk/news/rss.xml',                          lean: 'center', name: 'BBC' },
  { url: 'https://feeds.reuters.com/reuters/topNews',                       lean: 'center', name: 'Reuters' },
  { url: 'https://apnews.com/rss',                                          lean: 'center', name: 'AP' },
  { url: 'https://moxie.foxnews.com/google-publisher/latest.xml',           lean: 'right',  name: 'Fox News' },
  { url: 'https://feeds.feedburner.com/breitbart',                          lean: 'right',  name: 'Breitbart' },
  { url: 'https://www.wsj.com/xml/rss/3_7085.xml',                         lean: 'right',  name: 'WSJ' },
];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 Meridian/1.0' }, timeout: 8000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function parseRSS(xml, sourceName, lean) {
  const items = [];
  const itemRe = /<item[\s\S]*?<\/item>/gi;
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    const item = match[0];
    const title = (/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/.exec(item) ||
                   /<title[^>]*>([\s\S]*?)<\/title>/.exec(item) || [])[1];
    const desc  = (/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/.exec(item) ||
                   /<description[^>]*>([\s\S]*?)<\/description>/.exec(item) || [])[1];
    if (title && title.trim() && !title.includes('<?xml')) {
      items.push({
        title: title.replace(/<[^>]+>/g, '').trim(),
        description: (desc || '').replace(/<[^>]+>/g, '').trim().slice(0, 200),
        source: sourceName,
        lean
      });
    }
    if (items.length >= 5) break;
  }
  return items;
}

async function fetchAllFeeds() {
  const results = await Promise.allSettled(
    FEEDS.map(f => fetchUrl(f.url).then(xml => parseRSS(xml, f.name, f.lean)))
  );
  const all = [];
  results.forEach(r => { if (r.status === 'fulfilled') all.push(...r.value); });
  return all;
}

function groupByTopic(articles) {
  const patterns = [
    [/trump|biden|congress|senate|white house|democrat|republican|election|legislation|president/i, 'Politics'],
    [/economy|inflation|fed|interest rate|gdp|jobs|unemployment|stock|market|recession|tariff/i, 'Economy'],
    [/ukraine|russia|china|israel|gaza|nato|iran|north korea|war|military|foreign/i, 'World'],
    [/ai|artificial intelligence|tech|apple|google|microsoft|openai|meta|amazon|cyber/i, 'Technology'],
    [/health|vaccine|fda|hospital|drug|mental health|healthcare|cancer|disease/i, 'Health'],
    [/climate|environment|carbon|emissions|wildfire|flood|hurricane|energy|oil/i, 'Environment'],
  ];

  const groups = {};
  articles.forEach(a => {
    const text = a.title + ' ' + a.description;
    let cat = 'General';
    for (const [re, label] of patterns) {
      if (re.test(text)) { cat = label; break; }
    }
    if (!groups[cat]) groups[cat] = { left: [], center: [], right: [], category: cat };
    groups[cat][a.lean].push(a);
  });

  // Pick top 6 categories that have at least one article
  return Object.values(groups)
    .filter(g => g.left.length + g.center.length + g.right.length > 0)
    .slice(0, 6)
    .map((g, i) => {
      const allArts = [...g.left, ...g.center, ...g.right];
      const best = allArts[0];
      return {
        id: i + 1,
        category: g.category,
        headline: best.title,
        teaser: best.description || '',
        convergence: Math.floor(25 + Math.random() * 45),
        sources: {
          left:   g.left.map(a => a.title).slice(0, 2),
          center: g.center.map(a => a.title).slice(0, 2),
          right:  g.right.map(a => a.title).slice(0, 2),
        }
      };
    });
}

function callClaude(prompt, maxTokens) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens || 1000,
      messages: [{ role: 'user', content: prompt }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(data);
          if (d.error) return reject(new Error(d.error.message));
          const text = d.content.filter(b => b.type === 'text').map(b => b.text).join('');
          resolve(text.replace(/```json|```/g, '').trim());
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Cache stories for 30 minutes
let cache = { stories: null, ts: 0 };

async function getStories() {
  const now = Date.now();
  if (cache.stories && now - cache.ts < 30 * 60 * 1000) return cache.stories;

  const articles = await fetchAllFeeds();
  let stories;

  if (articles.length >= 4) {
    stories = groupByTopic(articles);
    // If we got fewer than 6, pad with Claude
    if (stories.length < 4) throw new Error('Not enough RSS articles');
  } else {
    throw new Error('RSS fetch failed');
  }

  cache = { stories, ts: now };
  return stories;
}

// Simple router
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = req.url.split('?')[0];

  // Serve the frontend
  if (url === '/' || url === '/index.html') {
    const fs = require('fs');
    const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(html);
    return;
  }

  // GET /api/stories — fetch RSS and return grouped stories
  if (url === '/api/stories') {
    try {
      const stories = await getStories();
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, stories }));
    } catch(e) {
      // Fallback: Claude generates stories
      try {
        const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
        const raw = await callClaude(
          'Today is ' + today + '. List the 6 biggest real US news stories happening right now. Return ONLY a JSON array:\n[{"id":1,"category":"Politics","headline":"Real headline","teaser":"2 neutral sentences.","convergence":35},{"id":2,"category":"Economy","headline":"...","teaser":"...","convergence":55},{"id":3,"category":"World","headline":"...","teaser":"...","convergence":50},{"id":4,"category":"Technology","headline":"...","teaser":"...","convergence":60},{"id":5,"category":"Health","headline":"...","teaser":"...","convergence":65},{"id":6,"category":"Environment","headline":"...","teaser":"...","convergence":40}]',
          900
        );
        const stories = JSON.parse(raw);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, stories, source: 'claude' }));
      } catch(e2) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: e2.message }));
      }
    }
    return;
  }

  // POST /api/synthesize — synthesize a story
  if (url === '/api/synthesize' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { headline, category, sources } = JSON.parse(body);
        const sourceCtx = sources
          ? 'Left sources say: ' + (sources.left || []).join(' | ') +
            '\nCenter sources say: ' + (sources.center || []).join(' | ') +
            '\nRight sources say: ' + (sources.right || []).join(' | ')
          : '';

        const raw = await callClaude(
          'You are Meridian\'s synthesis engine.\nHeadline: "' + headline + '"\nCategory: ' + category + '\n' + sourceCtx + '\n\nReturn ONLY valid JSON:\n{"synthesizedArticle":"4 paragraphs separated by blank lines. Para1: factual core. Para2: left/progressive framing. Para3: right/conservative framing. Para4: centrist synthesis and what happens next. 300-380 words, journalistic.","convergenceScore":50,"consensusKernel":"What all sides agree on.","leftTake":"1 sentence.","centerTake":"1 sentence.","rightTake":"1 sentence.","faultLines":["disagreement 1","disagreement 2","disagreement 3"],"blindEyes":{"left":"what left omits","center":"what center misses","right":"what right omits"}}',
          1300
        );
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, synthesis: JSON.parse(raw) }));
      } catch(e) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // POST /api/brief — generate 60-second brief
  if (url === '/api/brief' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { headline, category } = JSON.parse(body);
        const raw = await callClaude(
          'Write a 60-second brief for this news story. One punchy paragraph, plain English, no jargon, no political spin. Just the facts anyone needs to understand what happened and why it matters. Under 80 words.\n\nHeadline: "' + headline + '"\nCategory: ' + category + '\n\nReturn ONLY the paragraph text, nothing else.',
          200
        );
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, brief: raw }));
      } catch(e) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // Serve inquiry game
  if (url === '/inquiry') {
    const fs = require('fs');
    const html = fs.readFileSync(__dirname + '/public/inquiry.html', 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(html);
    return;
  }

  // Serve terms page
  if (url === '/terms') {
    const fs = require('fs');
    const html = fs.readFileSync(__dirname + '/public/terms.html', 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(html);
    return;
  }

  // Serve privacy page
  if (url === '/privacy') {
    const fs = require('fs');
    const html = fs.readFileSync(__dirname + '/public/privacy.html', 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(html);
    return;
  }

  // POST /api/inquiry-event — generate today's historical event
  if (url === '/api/inquiry-event' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { date } = JSON.parse(body);
        const d = new Date(date);
        const month = d.toLocaleDateString('en-US',{month:'long'});
        const day = d.getDate();
        const raw = await callClaude(
          'Give me one significant historical event that happened on ' + month + ' ' + day + ' in history. Pick something genuinely interesting and educational — not too obscure, not too obvious.\n\nReturn ONLY valid JSON:\n{"event":"Name of the event","year":1969,"description":"2-3 sentence factual description of what happened and why it matters.","connection":"1 sentence connecting this historical event to themes relevant in todays news and media landscape."}',
          400
        );
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, event: JSON.parse(raw) }));
      } catch(e) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // POST /api/inquiry-answer — answer a yes/no question about the event
  if (url === '/api/inquiry-answer' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { question, event, year, qa } = JSON.parse(body);
        const history = (qa||[]).map(x => 'Q: ' + x.q + ' A: ' + x.a).join('\n');
        const raw = await callClaude(
          'You are the host of a history guessing game. The hidden event is: "' + event + '" (' + year + ').\n\nPrevious questions:\n' + (history||'None') + '\n\nNew question: "' + question + '"\n\nAnswer ONLY with one word: YES, NO, or PARTLY. Nothing else.',
          10
        );
        const answer = raw.trim().toUpperCase().includes('YES') ? 'YES' : raw.trim().toUpperCase().includes('PARTLY') ? 'PARTLY' : 'NO';
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, answer }));
      } catch(e) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // POST /api/inquiry-judge — judge if the guess is correct
  if (url === '/api/inquiry-judge' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { guess, event, year } = JSON.parse(body);
        const raw = await callClaude(
          'The correct answer is: "' + event + '" (' + year + ').\nThe player guessed: "' + guess + '"\n\nIs this correct or close enough to be correct? Be generous — if they got the main idea right, it counts.\n\nRespond with only one word: YES or NO.',
          10
        );
        const correct = raw.trim().toUpperCase().includes('YES');
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, correct }));
      } catch(e) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => console.log('Meridian server running on port ' + PORT));
