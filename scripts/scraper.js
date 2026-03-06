const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');

const DATA_FILE = path.join(__dirname, '../data/trends.json');
const parser = new Parser();

// Full browser-like headers to avoid 403 blocks
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
};

// Google News RSS fallback for sites that block direct RSS or have no RSS feed
const GOOGLE_NEWS_FALLBACK = {
    // iGaming
    "https://igamingbusiness.com/feed/": "https://news.google.com/rss/search?q=site:igamingbusiness.com+when:14d&hl=en-US&gl=US&ceid=US:en",
    "https://next.io/feed/": "https://news.google.com/rss/search?q=site:next.io+when:14d&hl=en-US&gl=US&ceid=US:en",
    "https://steamdb.info/blog/feed/": "https://news.google.com/rss/search?q=site:steamdb.info+when:14d&hl=en-US&gl=US&ceid=US:en",
    // Regulation & Gambling bodies (no RSS)
    "__gnews_egr.global": "https://news.google.com/rss/search?q=site:egr.global+when:14d&hl=en-US&gl=US&ceid=US:en",
    "__gnews_iagr.org": "https://news.google.com/rss/search?q=site:iagr.org+when:14d&hl=en-US&gl=US&ceid=US:en",
    "__gnews_gamblingcommission.gov.uk": "https://news.google.com/rss/search?q=site:gamblingcommission.gov.uk+when:14d&hl=en-US&gl=US&ceid=US:en",
    "__gnews_mga.org.mt": "https://news.google.com/rss/search?q=site:mga.org.mt+when:14d&hl=en-US&gl=US&ceid=US:en",
    "__gnews_egba.eu": "https://news.google.com/rss/search?q=site:egba.eu+when:14d&hl=en-US&gl=US&ceid=US:en",
    "__gnews_nj.gov/oag/ge": "https://news.google.com/rss/search?q=site:nj.gov+igaming+OR+gambling+when:14d&hl=en-US&gl=US&ceid=US:en",
    // AI Art & Tools (no RSS)
    "__gnews_civitai.com": "https://news.google.com/rss/search?q=site:civitai.com+when:14d&hl=en-US&gl=US&ceid=US:en",
    "__gnews_prompthero.com": "https://news.google.com/rss/search?q=site:prompthero.com+when:14d&hl=en-US&gl=US&ceid=US:en",
    "__gnews_openart.ai": "https://news.google.com/rss/search?q=site:openart.ai+when:14d&hl=en-US&gl=US&ceid=US:en",
    "__gnews_lexica.art": "https://news.google.com/rss/search?q=site:lexica.art+when:14d&hl=en-US&gl=US&ceid=US:en",
    "__gnews_futurepedia.io": "https://news.google.com/rss/search?q=site:futurepedia.io+when:14d&hl=en-US&gl=US&ceid=US:en",
    // AI Video
    "__gnews_synthesia.io": "https://news.google.com/rss/search?q=site:synthesia.io+when:14d&hl=en-US&gl=US&ceid=US:en",
    "__gnews_heygen.com": "https://news.google.com/rss/search?q=site:heygen.com+when:14d&hl=en-US&gl=US&ceid=US:en",
    // Game Dev
    "__gnews_pixijs.com": "https://news.google.com/rss/search?q=site:pixijs.com+when:14d&hl=en-US&gl=US&ceid=US:en",
    "__gnews_esotericsoftware.com": "https://news.google.com/rss/search?q=site:esotericsoftware.com+when:14d&hl=en-US&gl=US&ceid=US:en",
    // Adobe
    "__gnews_adobe_photoshop": "https://news.google.com/rss/search?q=site:helpx.adobe.com+photoshop+when:14d&hl=en-US&gl=US&ceid=US:en",
    "__gnews_adobe_trends": "https://news.google.com/rss/search?q=site:adobe.com+design+trends+when:14d&hl=en-US&gl=US&ceid=US:en",
};

/**
 * Resilient RSS fetcher: tries direct fetch with full browser headers first,
 * then falls back to Google News RSS if the site returns 403.
 */
async function fetchFeedResilient(feedUrl, sourceName) {
    // Attempt 1: Direct fetch with full browser headers
    try {
        const response = await fetch(feedUrl, {
            headers: BROWSER_HEADERS,
            redirect: 'follow'
        });
        if (response.status === 403) {
            throw new Error('Status code 403');
        }
        if (!response.ok) {
            throw new Error(`Status code ${response.status}`);
        }
        const xml = await response.text();
        return await parser.parseString(xml);
    } catch (directError) {
        // Attempt 2: Google News fallback
        const fallbackUrl = GOOGLE_NEWS_FALLBACK[feedUrl];
        if (fallbackUrl) {
            console.log(`  ↳ Direct fetch failed (${directError.message}), trying Google News fallback...`);
            try {
                const fallbackResponse = await fetch(fallbackUrl, {
                    headers: BROWSER_HEADERS,
                    redirect: 'follow'
                });
                if (!fallbackResponse.ok) {
                    throw new Error(`Fallback HTTP ${fallbackResponse.status}`);
                }
                const xml = await fallbackResponse.text();
                return await parser.parseString(xml);
            } catch (fallbackError) {
                throw new Error(`Direct: ${directError.message} | Fallback: ${fallbackError.message}`);
            }
        }
        throw directError;
    }
}

// Groq API configuration (replaces Gemini — 30 RPM / 14,400 RPD free tier)
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// A mapping of source URLs to their RSS feeds, matching the domains in active sources
const RSS_FEEDS = {
    // iGaming
    "https://igamingbusiness.com": "https://igamingbusiness.com/feed/",
    "https://sbcnews.co.uk": "https://sbcnews.co.uk/feed/",
    "https://gamblinginsider.com": "https://www.gamblinginsider.com/feed",
    "https://next.io": "https://next.io/feed/",
    // AI & Tech
    "https://venturebeat.com/category/ai": "https://venturebeat.com/category/ai/feed/",
    "https://huggingface.co/blog": "https://huggingface.co/blog/feed.xml",
    // Game Dev
    "https://www.gamedeveloper.com": "https://www.gamedeveloper.com/rss.xml",
    "https://blog.unity.com": "https://blog.unity.com/feed",
    "https://steamdb.info/blog": "https://steamdb.info/blog/feed/",
    "https://esotericsoftware.com/forum": "https://esotericsoftware.com/forum/tags/releases/feed",
};

// Sources without RSS that use Google News as their feed
const GOOGLE_NEWS_ONLY_SOURCES = [
    { url: "https://egr.global", name: "EGR Global", gnewsKey: "__gnews_egr.global" },
    { url: "https://iagr.org", name: "IAGR", gnewsKey: "__gnews_iagr.org" },
    { url: "https://gamblingcommission.gov.uk", name: "UK Gambling Commission", gnewsKey: "__gnews_gamblingcommission.gov.uk" },
    { url: "https://mga.org.mt", name: "Malta Gaming Authority", gnewsKey: "__gnews_mga.org.mt" },
    { url: "https://egba.eu", name: "EGBA", gnewsKey: "__gnews_egba.eu" },
    { url: "https://nj.gov/oag/ge", name: "NJ DGE", gnewsKey: "__gnews_nj.gov/oag/ge" },
    { url: "https://civitai.com", name: "Civitai", gnewsKey: "__gnews_civitai.com" },
    { url: "https://prompthero.com", name: "PromptHero", gnewsKey: "__gnews_prompthero.com" },
    { url: "https://openart.ai", name: "OpenArt", gnewsKey: "__gnews_openart.ai" },
    { url: "https://lexica.art", name: "Lexica", gnewsKey: "__gnews_lexica.art" },
    { url: "https://futurepedia.io", name: "Futurepedia", gnewsKey: "__gnews_futurepedia.io" },
    { url: "https://synthesia.io", name: "Synthesia", gnewsKey: "__gnews_synthesia.io" },
    { url: "https://heygen.com", name: "HeyGen", gnewsKey: "__gnews_heygen.com" },
    { url: "https://pixijs.com/blog", name: "PixiJS Blog", gnewsKey: "__gnews_pixijs.com" },
    { url: "https://esotericsoftware.com", name: "Esoteric (Spine)", gnewsKey: "__gnews_esotericsoftware.com" },
    { url: "https://helpx.adobe.com/photoshop", name: "Adobe Photoshop", gnewsKey: "__gnews_adobe_photoshop" },
    { url: "https://adobe.com/express/learn/blog/design-trends", name: "Adobe Trends", gnewsKey: "__gnews_adobe_trends" },
];

// Reddit APIs (fetch top posts from the week)
const REDDIT_SOURCES = {
    "https://reddit.com/r/StableDiffusion": "https://www.reddit.com/r/StableDiffusion/top.json?t=week&limit=15",
    "https://reddit.com/r/LocalLLaMA": "https://www.reddit.com/r/LocalLLaMA/top.json?t=week&limit=15",
    "https://reddit.com/r/Spine2D": "https://www.reddit.com/r/Spine2D/top.json?t=week&limit=15",
    "https://reddit.com/r/iGaming": "https://www.reddit.com/r/iGaming/top.json?t=month&limit=10"
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function generateTrendFromArticle(article, sourceName) {
    console.log(`Analyzing: ${article.title}`);
    const systemPrompt = `You are an expert iGaming and Tech analyst for "VisualTrendHub".
Read article snippets and extract trend objects in pure JSON matching this exact schema:
{
  "title": "Short catchy title (max 5 words)",
  "subtitle": "One sentence summary",
  "category": "Choose ONE of: iGaming, AI, Art, Tech, Community",
  "tags": ["Tag1", "Tag2", "Tag3"],
  "trendStrength": number between 1 and 5,
  "velocity": "rising" or "stable" or "cooling",
  "whatsNew": "2-3 sentences max summarizing the novel part.",
  "whyItMatters": "1-2 sentences on impact.",
  "howToUse": "Actionable advice, 1-2 sentences.",
  "beneficiaries": ["Role 1", "Role 2"],
  "companies": ["Company name if mentioned"],
  "cluster": "Choose ONE of: ai-in-igaming, igaming-innovation, studio-releases, regulation, local-ai, ai-automation, ai-video, ai-art-pipeline, animation-pipeline, rendering-tech, frontend-tools, pixi-slot-tech, visual-style-trends, slot-art-themes, community-ai-ethics"
}
Return ONLY the JSON object. No markdown, no explanation.`;

    const userPrompt = `Article Details:
Title: ${article.title}
Date: ${article.pubDate}
Source: ${sourceName}
Content: ${article.contentSnippet || ''}`;

    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [5000, 15000, 30000];

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        // Groq allows 30 RPM -> wait ~2s between requests
        await delay(2000);

        try {
            const response = await fetch(GROQ_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: GROQ_MODEL,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.3,
                    max_tokens: 800,
                    response_format: { type: 'json_object' }
                })
            });

            if (response.status === 429) {
                const body = await response.text();
                const isQuotaExhausted = body.includes('limit') && body.includes('exceeded');
                if (isQuotaExhausted && attempt >= 2) {
                    console.error(`  ❌ Groq quota exhausted — stopping API calls.`);
                    return '__QUOTA_EXHAUSTED__';
                }
                const waitSec = RETRY_DELAYS[attempt - 1] / 1000;
                console.warn(`  ⏳ Rate limited (attempt ${attempt}/${MAX_RETRIES}), waiting ${waitSec}s...`);
                await delay(RETRY_DELAYS[attempt - 1]);
                continue;
            }

            if (!response.ok) {
                throw new Error(`Groq API error: HTTP ${response.status} - ${await response.text()}`);
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content;
            if (!content) throw new Error('Empty response from Groq');

            let cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
            let parsedResult = JSON.parse(cleanJson);

            return {
                id: 't-' + Math.random().toString(36).substr(2, 9),
                title: parsedResult.title,
                subtitle: parsedResult.subtitle,
                category: parsedResult.category,
                tags: parsedResult.tags || [],
                trendStrength: parsedResult.trendStrength || 3,
                velocity: parsedResult.velocity || "stable",
                source: {
                    name: sourceName,
                    url: article.link,
                    date: new Date(article.pubDate).toISOString()
                },
                whatsNew: parsedResult.whatsNew,
                whyItMatters: parsedResult.whyItMatters,
                howToUse: parsedResult.howToUse,
                beneficiaries: parsedResult.beneficiaries || [],
                companies: parsedResult.companies || [],
                visualStyle: null,
                cluster: parsedResult.cluster || "igaming-innovation",
                isNew: true
            };

        } catch (err) {
            if (attempt >= MAX_RETRIES) {
                console.error("Analysis failed for:", article.title, err.message);
                return null;
            }
            console.warn(`  ⚠️ Attempt ${attempt} failed: ${err.message}, retrying...`);
            await delay(RETRY_DELAYS[attempt - 1]);
        }
    }
    return null;
}

async function run() {
    console.log("Starting VisualTrendHub Automated Scraper...");
    if (!process.env.GROQ_API_KEY) {
        console.warn("⚠️ GROQ_API_KEY is not set. The scraper cannot generate content. Exiting.");
        process.exit(0); // Exit gracefully so CI doesn't fail if we just want to skip
    }

    let data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    let existingUrls = new Set(data.trends.map(t => t.source.url));

    // Clear `isNew` flag from older trends
    data.trends.forEach(t => t.isNew = false);

    let newlyFoundTrends = [];
    let sourceResults = {}; // A5: Track success/error per source

    // A4: Build a set of existing titles (lowercase) to catch Google News duplicates with different URLs
    let existingTitles = new Set(data.trends.map(t => t.title.toLowerCase()));

    let activeSources = data.sourceHealth.filter(s => s.status !== 'error');
    // Groq allows 14,400 RPD - safe to process more per run
    let processedThisRun = 0;
    const MAX_REQUESTS_PER_RUN = 30;

    for (let source of activeSources) {
        if (processedThisRun >= MAX_REQUESTS_PER_RUN) {
            console.log(`\nReached the maximum ${MAX_REQUESTS_PER_RUN} API requests for this run. Halting further API calls.`);
            break;
        }

        // Find RSS feed
        let feedUrl = RSS_FEEDS[source.url.replace(/\/$/, '')]; // strip trailing slash
        if (!feedUrl) continue;

        console.log(`\nFetching RSS for ${source.name}: ${feedUrl}`);
        try {
            let feed = await fetchFeedResilient(feedUrl, source.name);

            // Limit to top 30 safest recent items per feed to avoid massive API bursts
            let recentItems = feed.items.slice(0, 30);

            for (let item of recentItems) {
                if (existingUrls.has(item.link)) continue; // Already processed
                // A4: Also skip if title already exists (catches Google News URL variants)
                const itemTitleLower = (item.title || '').toLowerCase().replace(/ - .*$/, '').trim();
                if (existingTitles.has(itemTitleLower)) continue;

                // Only process if published within the last 14 days
                let pubDate = new Date(item.pubDate);
                let daysOld = (Date.now() - pubDate.getTime()) / (1000 * 3600 * 24);
                if (daysOld > 14) continue;

                console.log(`Found NEW Article: [${pubDate.toISOString().split('T')[0]}] ${item.title}`);
                let trend = await generateTrendFromArticle(item, source.name);
                processedThisRun++;

                if (trend === '__QUOTA_EXHAUSTED__') {
                    processedThisRun = MAX_REQUESTS_PER_RUN; // Force outer loop to stop too
                    break;
                }
                if (trend) {
                    newlyFoundTrends.push(trend);
                    existingUrls.add(item.link);
                    existingTitles.add(trend.title.toLowerCase());
                }

                if (processedThisRun >= MAX_REQUESTS_PER_RUN) {
                    break;
                }
            }
            sourceResults[source.name] = { status: 'healthy' };
        } catch (err) {
            console.error(`Failed to fetch ${source.name}: ${err.message}`);
            sourceResults[source.name] = { status: 'error', error: err.message };
        }
    }

    // Process Reddit Sources
    for (let source of activeSources) {
        if (processedThisRun >= MAX_REQUESTS_PER_RUN) {
            break;
        }

        let apiUrl = REDDIT_SOURCES[source.url.replace(/\/$/, '')];
        if (!apiUrl) continue;

        console.log(`\nFetching Reddit API for ${source.name}: ${apiUrl}`);
        try {
            const response = await fetch(apiUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const json = await response.json();

            const posts = json.data.children || [];

            for (let post of posts) {
                let item = post.data;
                let postUrl = `https://reddit.com${item.permalink}`;
                if (existingUrls.has(postUrl)) continue;

                // Create a simulated article object for Gemini
                let article = {
                    title: item.title,
                    pubDate: new Date(item.created_utc * 1000).toISOString(),
                    link: postUrl,
                    contentSnippet: item.selftext ? item.selftext.substring(0, 500) : "Image/Link post"
                };

                let pubDate = new Date(article.pubDate);
                let daysOld = (Date.now() - pubDate.getTime()) / (1000 * 3600 * 24);
                if (daysOld > 14) continue;

                console.log(`Found NEW Article: [${pubDate.toISOString().split('T')[0]}] ${article.title}`);
                let trend = await generateTrendFromArticle(article, source.name);
                processedThisRun++;

                if (trend === '__QUOTA_EXHAUSTED__') {
                    processedThisRun = MAX_REQUESTS_PER_RUN;
                    break;
                }
                if (trend) {
                    newlyFoundTrends.push(trend);
                    existingUrls.add(article.link);
                }

                if (processedThisRun >= MAX_REQUESTS_PER_RUN) {
                    break;
                }
            }
            sourceResults[source.name] = { status: 'healthy' };
        } catch (err) {
            console.error(`Failed to fetch ${source.name}: ${err.message}`);
            sourceResults[source.name] = { status: 'error', error: err.message };
        }
    }

    // Process Google News-only Sources (sites without RSS feeds)
    for (let gnSource of GOOGLE_NEWS_ONLY_SOURCES) {
        if (processedThisRun >= MAX_REQUESTS_PER_RUN) {
            break;
        }

        const gnewsUrl = GOOGLE_NEWS_FALLBACK[gnSource.gnewsKey];
        if (!gnewsUrl) continue;

        console.log(`\nFetching Google News for ${gnSource.name}...`);
        try {
            const response = await fetch(gnewsUrl, {
                headers: BROWSER_HEADERS,
                redirect: 'follow'
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const xml = await response.text();
            const feed = await parser.parseString(xml);

            let recentItems = feed.items.slice(0, 10); // Limit per source

            for (let item of recentItems) {
                if (existingUrls.has(item.link)) continue;
                const itemTitleLower = (item.title || '').toLowerCase().replace(/ - .*$/, '').trim();
                if (existingTitles.has(itemTitleLower)) continue;

                let pubDate = new Date(item.pubDate);
                let daysOld = (Date.now() - pubDate.getTime()) / (1000 * 3600 * 24);
                if (daysOld > 14) continue;

                console.log(`Found NEW Article: [${pubDate.toISOString().split('T')[0]}] ${item.title}`);
                let trend = await generateTrendFromArticle(item, gnSource.name);
                processedThisRun++;

                if (trend === '__QUOTA_EXHAUSTED__') {
                    processedThisRun = MAX_REQUESTS_PER_RUN;
                    break;
                }
                if (trend) {
                    newlyFoundTrends.push(trend);
                    existingUrls.add(item.link);
                    existingTitles.add(trend.title.toLowerCase());
                }

                if (processedThisRun >= MAX_REQUESTS_PER_RUN) {
                    break;
                }
            }
            sourceResults[gnSource.name] = { status: 'healthy' };
        } catch (err) {
            console.error(`Failed to fetch ${gnSource.name}: ${err.message}`);
            sourceResults[gnSource.name] = { status: 'error', error: err.message };
        }
    }

    if (newlyFoundTrends.length > 0) {
        console.log(`\nSuccessfully generated ${newlyFoundTrends.length} new trends!`);
        // Add new trends to the TOP of the array
        data.trends = [...newlyFoundTrends, ...data.trends];
    } else {
        console.log("\nNo new trends discovered in this run.");
    }

    // A1: Archive trends older than 30 days
    const ARCHIVE_DAYS = 30;
    const archiveCutoff = Date.now() - (ARCHIVE_DAYS * 24 * 3600 * 1000);
    const activeTrends = [];
    const archivedTrends = data.archived || [];
    for (const t of data.trends) {
        const tDate = t.source?.date ? new Date(t.source.date).getTime() : 0;
        if (tDate && tDate < archiveCutoff) {
            archivedTrends.push(t);
        } else {
            activeTrends.push(t);
        }
    }
    if (data.trends.length !== activeTrends.length) {
        console.log(`Archived ${data.trends.length - activeTrends.length} trends older than ${ARCHIVE_DAYS} days.`);
    }
    data.trends = activeTrends;
    data.archived = archivedTrends;

    // A2: Auto-update meta.totalTrends
    data.meta.totalTrends = data.trends.length;
    data.meta.scanDate = new Date().toISOString();

    // A5: Update sourceHealth lastScan and status
    for (const sh of (data.sourceHealth || [])) {
        if (sourceResults[sh.name]) {
            sh.lastScan = new Date().toISOString();
            sh.status = sourceResults[sh.name].status;
            if (sourceResults[sh.name].error) {
                sh.errorReason = sourceResults[sh.name].error;
            } else {
                delete sh.errorReason;
            }
        }
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4));
    console.log(`Updated data/trends.json successfully! (${data.trends.length} active, ${archivedTrends.length} archived)`);
}

run();
