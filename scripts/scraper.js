const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const OpenAI = require('openai');

const DATA_FILE = path.join(__dirname, '../data/trends.json');
const parser = new Parser();

// Configure OpenAI. Expects process.env.OPENAI_API_KEY
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// A mapping of source URLs to their RSS feeds, matching the domains in active sources
const RSS_FEEDS = {
    "https://igamingbusiness.com": "https://igamingbusiness.com/feed/",
    "https://sbcnews.co.uk": "https://sbcnews.co.uk/feed/",
    "https://gamblinginsider.com": "https://www.gamblinginsider.com/rss/news.xml",
    "https://blog.unity.com": "https://blog.unity.com/feed",
    "https://huggingface.co/blog": "https://huggingface.co/blog/feed.xml"
};

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
`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
        });

        let result = JSON.parse(response.choices[0].message.content);

        // Build the final trend object
        return {
            id: 't-' + Math.random().toString(36).substr(2, 9),
            title: result.title,
            subtitle: result.subtitle,
            category: result.category,
            tags: result.tags || [],
            trendStrength: result.trendStrength || 3,
            velocity: result.velocity || "stable",
            source: {
                name: sourceName,
                url: article.link,
                date: new Date(article.pubDate).toISOString() // USE EXACT ORIGINAL DATE
            },
            whatsNew: result.whatsNew,
            whyItMatters: result.whyItMatters,
            howToUse: result.howToUse,
            beneficiaries: result.beneficiaries || [],
            companies: result.companies || [],
            visualStyle: null,
            cluster: result.cluster || "igaming-innovation",
            isNew: true // Flag to highlight this as brand new in UI
        };

    } catch (err) {
        console.error("OpenAI mapping failed for:", article.title, err);
        return null;
    }
}

async function run() {
    console.log("Starting VisualTrendHub Automated Scraper...");
    if (!process.env.OPENAI_API_KEY) {
        console.warn("⚠️ OPENAI_API_KEY is not set. The scraper cannot generate content. Exiting.");
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

            // Limit to top 3 safest recent items per feed to avoid massive API bursts
            let recentItems = feed.items.slice(0, 3);

            for (let item of recentItems) {
                if (existingUrls.has(item.link)) continue; // Already processed

                // Only process if published within the last 3 days
                let pubDate = new Date(item.pubDate);
                let daysOld = (Date.now() - pubDate.getTime()) / (1000 * 3600 * 24);
                if (daysOld > 3) continue;

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
