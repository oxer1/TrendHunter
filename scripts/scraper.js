const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const DATA_FILE = path.join(__dirname, '../data/trends.json');
const parser = new Parser({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
});

// Configure Gemini. Expects process.env.GEMINI_API_KEY
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// A mapping of source URLs to their RSS feeds, matching the domains in active sources
const RSS_FEEDS = {
    "https://igamingbusiness.com": "https://igamingbusiness.com/feed/",
    "https://sbcnews.co.uk": "https://sbcnews.co.uk/feed/",
    "https://gamblinginsider.com": "https://www.gamblinginsider.com/feed",
    "https://blog.unity.com": "https://blog.unity.com/feed",
    "https://huggingface.co/blog": "https://huggingface.co/blog/feed.xml",
    "https://www.gamedeveloper.com": "https://www.gamedeveloper.com/rss.xml",
    "https://next.io": "https://next.io/feed/",
    "https://venturebeat.com/category/ai": "https://venturebeat.com/category/ai/feed/",
    "https://esotericsoftware.com/forum": "https://esotericsoftware.com/forum/tags/releases/feed",
    "https://steamdb.info/blog": "https://steamdb.info/blog/feed/"
};

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
    const prompt = `
You are an expert iGaming and Tech analyst for "VisualTrendHub".
Read the following article snippet and extract a trend object in pure JSON.
The JSON must strictly match this schema:
{
  "title": "Short catchy title (max 5 words)",
  "subtitle": "One sentence summary",
  "category": "Choose ONE of: iGaming, AI, Art, Tech, Community",
  "tags": ["Tag1", "Tag2", "Tag3"], // max 4 tags
  "trendStrength": number between 1 and 5,
  "velocity": "rising" or "stable" or "cooling",
  "whatsNew": "2-3 sentences max summarizing the novel part.",
  "whyItMatters": "1-2 sentences on impact.",
  "howToUse": "Actionable advice, 1-2 sentences.",
  "beneficiaries": ["Role 1", "Role 2"], // max 3 roles
  "companies": ["Company name if mentioned"], // max 3
  "cluster": "Choose ONE of: ai-in-igaming, igaming-innovation, studio-releases, regulation, local-ai, ai-automation, ai-video, ai-art-pipeline, animation-pipeline, rendering-tech, frontend-tools, pixi-slot-tech, visual-style-trends, slot-art-themes, community-ai-ethics"
}

Article Details:
Title: ${article.title}
Date: ${article.pubDate}
Source Name: ${sourceName}
Content: ${article.contentSnippet}

CRITICAL: Return ONLY the JSON object. Do not include markdown formatting like \`\`\`json.
`;

    // Respect Gemini free tier limits (15 RPM -> wait ~4-5 seconds between requests)
    await delay(4200);

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { responseMimeType: "application/json" } });
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        // Strip markdown if present just in case
        let cleanJson = responseText.replace(/```json\n?|\n?```/g, "").trim();
        let parsedResult = JSON.parse(cleanJson);

        // Build the final trend object
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
                date: new Date(article.pubDate).toISOString() // USE EXACT ORIGINAL DATE
            },
            whatsNew: parsedResult.whatsNew,
            whyItMatters: parsedResult.whyItMatters,
            howToUse: parsedResult.howToUse,
            beneficiaries: parsedResult.beneficiaries || [],
            companies: parsedResult.companies || [],
            visualStyle: null,
            cluster: parsedResult.cluster || "igaming-innovation",
            isNew: true // Flag to highlight this as brand new in UI
        };

    } catch (err) {
        console.error("Gemini mapping failed for:", article.title, err.message);
        return null;
    }
}

async function run() {
    console.log("Starting VisualTrendHub Automated Scraper...");
    if (!process.env.GEMINI_API_KEY) {
        console.warn("⚠️ GEMINI_API_KEY is not set. The scraper cannot generate content. Exiting.");
        process.exit(0); // Exit gracefully so CI doesn't fail if we just want to skip
    }

    let data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    let existingUrls = new Set(data.trends.map(t => t.source.url));

    // Clear `isNew` flag from older trends
    data.trends.forEach(t => t.isNew = false);

    let activeSources = data.sourceHealth.filter(s => s.status !== 'error');
    let newlyFoundTrends = [];

    for (let source of activeSources) {
        // Find RSS feed
        let feedUrl = RSS_FEEDS[source.url.replace(/\/$/, '')]; // strip trailing slash
        if (!feedUrl) continue;

        console.log(`\nFetching RSS for ${source.name}: ${feedUrl}`);
        try {
            let feed = await parser.parseURL(feedUrl);

            // Limit to top 30 safest recent items per feed to avoid massive API bursts
            let recentItems = feed.items.slice(0, 30);

            for (let item of recentItems) {
                if (existingUrls.has(item.link)) continue; // Already processed

                // Only process if published within the last 14 days
                let pubDate = new Date(item.pubDate);
                let daysOld = (Date.now() - pubDate.getTime()) / (1000 * 3600 * 24);
                if (daysOld > 14) continue;

                console.log(`Found NEW Article: [${pubDate.toISOString().split('T')[0]}] ${item.title}`);
                let trend = await generateTrendFromArticle(item, source.name);

                if (trend) {
                    newlyFoundTrends.push(trend);
                    existingUrls.add(item.link); // Add to set locally to prevent duplicates
                }
            }
        } catch (err) {
            console.error(`Failed to fetch ${source.name}: ${err.message}`);
        }
    }

    // Process Reddit Sources
    for (let source of activeSources) {
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

                if (trend) {
                    newlyFoundTrends.push(trend);
                    existingUrls.add(article.link);
                }
            }
        } catch (err) {
            console.error(`Failed to fetch ${source.name}: ${err.message}`);
        }
    }

    if (newlyFoundTrends.length > 0) {
        console.log(`\nSuccessfully generated ${newlyFoundTrends.length} new trends!`);
        // Add new trends to the TOP of the array
        data.trends = [...newlyFoundTrends, ...data.trends];
    } else {
        console.log("\nNo new trends discovered in this run.");
    }

    data.meta.scanDate = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4));
    console.log("Updated data/trends.json successfully!");
}

run();
