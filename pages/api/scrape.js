import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).json({});
    return;
  }

  // Add CORS headers to all responses
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ success: false, error: 'URL parameter is required' });
  }

  try {
    console.log(`Attempting to scrape: ${url}`);

    // Fetch the webpage
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract text based on the website
    let extractedText = '';

    if (url.includes('theunsentproject.com')) {
      // Specific scraping for The Unsent Project
      $('.post-content, .entry-content, .post, .message').each((i, el) => {
        extractedText += $(el).text().trim() + '\n\n';
      });
    } else if (url.includes('gutenberg.org')) {
      // Project Gutenberg books
      $('.chapter, .poem, p').each((i, el) => {
        const text = $(el).text().trim();
        if (text.length > 20) { // Skip very short paragraphs
          extractedText += text + '\n\n';
        }
      });
    } else if (url.includes('reddit.com')) {
      // Reddit posts
      $('.usertext-body, [data-testid="comment"], .md').each((i, el) => {
        extractedText += $(el).text().trim() + '\n\n';
      });
    } else if (url.includes('twitter.com') || url.includes('x.com')) {
      // Twitter/X posts
      $('[data-testid="tweetText"], .tweet-text').each((i, el) => {
        extractedText += $(el).text().trim() + '\n\n';
      });
    } else {
      // Generic scraping - try common content selectors
      const contentSelectors = [
        'article',
        '.post-content',
        '.entry-content', 
        '.content',
        'main p',
        '.post',
        '.message',
        'p'
      ];

      for (const selector of contentSelectors) {
        const elements = $(selector);
        if (elements.length > 0) {
          elements.each((i, el) => {
            const text = $(el).text().trim();
            if (text.length > 30) { // Only include substantial paragraphs
              extractedText += text + '\n\n';
            }
          });
          break; // Use the first selector that finds content
        }
      }

      // If no structured content found, try to get all text
      if (!extractedText.trim()) {
        $('script, style, nav, header, footer, .ad, .advertisement').remove();
        extractedText = $('body').text().replace(/\s+/g, ' ').trim();
      }
    }

    // Clean up the extracted text
    extractedText = extractedText
      .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
      .replace(/\n\s*\n/g, '\n\n') // Clean up paragraph breaks
      .trim();

    if (!extractedText || extractedText.length < 100) {
      return res.status(400).json({ 
        success: false, 
        error: 'Could not extract meaningful text from the URL. The site may be protected or have dynamic content.' 
      });
    }

    console.log(`Successfully extracted ${extractedText.length} characters`);

    return res.status(200).json({
      success: true,
      text: extractedText,
      wordCount: extractedText.split(/\s+/).length,
      url: url
    });

  } catch (error) {
    console.error('Scraping error:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to scrape the URL',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}