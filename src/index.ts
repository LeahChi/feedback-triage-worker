interface Env {
	FEEDBACK_KV: KVNamespace;
	AI: any;
}

interface FeedbackItem {
	id: string;
	source: 'support' | 'github' | 'community' | 'twitter';
	text: string;
	sentiment: 'Positive' | 'Neutral' | 'Negative';
	theme: 'Documentation' | 'Developer Experience' | 'Performance' | 'Pricing' | 'Billing' | 'Other';
	urgency: 'High' | 'Medium' | 'Low';
	priorityScore: number;
}

interface Digest {
	generatedAt: string;
	total: number;
	sentimentBreakdown: {
		Positive: number;
		Neutral: number;
		Negative: number;
	};
	topThemes: Array<{
		theme: string;
		count: number;
	}>;
	needsAttention: FeedbackItem[];
	pmSummary: string;
	summarySource: 'ai' | 'rule-based';
}

const mockFeedback: FeedbackItem[] = [
	{
		id: '1',
		source: 'support',
		text: 'The API documentation is unclear and missing examples',
		sentiment: 'Negative',
		theme: 'Documentation',
		urgency: 'High',
		priorityScore: 85
	},
	{
		id: '2',
		source: 'github',
		text: 'Love the new features! Keep up the great work',
		sentiment: 'Positive',
		theme: 'Developer Experience',
		urgency: 'Low',
		priorityScore: 25
	},
	{
		id: '3',
		source: 'community',
		text: 'Performance has improved significantly in the latest release',
		sentiment: 'Positive',
		theme: 'Performance',
		urgency: 'Medium',
		priorityScore: 45
	},
	{
		id: '4',
		source: 'twitter',
		text: 'Pricing is too expensive for small teams',
		sentiment: 'Negative',
		theme: 'Pricing',
		urgency: 'High',
		priorityScore: 90
	},
	{
		id: '5',
		source: 'support',
		text: 'Billing system is confusing and hard to understand',
		sentiment: 'Negative',
		theme: 'Billing',
		urgency: 'High',
		priorityScore: 88
	},
	{
		id: '6',
		source: 'github',
		text: 'The developer experience is excellent, very intuitive',
		sentiment: 'Positive',
		theme: 'Developer Experience',
		urgency: 'Low',
		priorityScore: 30
	},
	{
		id: '7',
		source: 'community',
		text: 'Documentation could use more real-world examples',
		sentiment: 'Neutral',
		theme: 'Documentation',
		urgency: 'Medium',
		priorityScore: 55
	},
	{
		id: '8',
		source: 'support',
		text: 'Response times are slow during peak hours',
		sentiment: 'Negative',
		theme: 'Performance',
		urgency: 'High',
		priorityScore: 82
	},
	{
		id: '9',
		source: 'twitter',
		text: 'Great customer service, resolved my issue quickly',
		sentiment: 'Positive',
		theme: 'Other',
		urgency: 'Low',
		priorityScore: 20
	},
	{
		id: '10',
		source: 'github',
		text: 'The setup process was straightforward and well-documented',
		sentiment: 'Positive',
		theme: 'Documentation',
		urgency: 'Low',
		priorityScore: 35
	},
	{
		id: '11',
		source: 'community',
		text: 'Would like to see more advanced features in the pricing tier',
		sentiment: 'Neutral',
		theme: 'Pricing',
		urgency: 'Medium',
		priorityScore: 60
	},
	{
		id: '12',
		source: 'support',
		text: 'Billing invoice format is confusing and lacks details',
		sentiment: 'Negative',
		theme: 'Billing',
		urgency: 'Medium',
		priorityScore: 75
	}
];

function calculatePriorityScore(item: Omit<FeedbackItem, 'priorityScore'>): number {
	let score = 50;

	const sentimentWeight = item.sentiment === 'Negative' ? 30 : item.sentiment === 'Neutral' ? 10 : -10;
	const urgencyWeight = item.urgency === 'High' ? 25 : item.urgency === 'Medium' ? 15 : 5;
	
	const themeWeight: Record<string, number> = {
		'Billing': 15,
		'Pricing': 12,
		'Documentation': 10,
		'Performance': 8,
		'Developer Experience': 5,
		'Other': 0
	};

	score += sentimentWeight + urgencyWeight + (themeWeight[item.theme] || 0);
	return Math.min(100, Math.max(0, score));
}

async function loadFeedbackItems(env: Env): Promise<FeedbackItem[]> {
	try {
		const raw = await env.FEEDBACK_KV.get("feedback_items");
		if (raw) {
			const parsed = JSON.parse(raw) as FeedbackItem[];
			if (Array.isArray(parsed) && parsed.length > 0) {
				return parsed;
			}
		}
	} catch (error) {
		console.error('Failed to load feedback from KV:', error);
	}
	return mockFeedback;
}

async function cacheDigest(env: Env, digest: Digest): Promise<void> {
	try {
		await env.FEEDBACK_KV.put("latest_digest", JSON.stringify(digest));
	} catch (error) {
		console.error('Failed to cache digest to KV:', error);
	}
}

async function generateAiSummary(env: Env, digestData: {
	sentimentBreakdown: { Positive: number; Neutral: number; Negative: number };
	topThemes: Array<{ theme: string; count: number }>;
	needsAttention: FeedbackItem[];
}): Promise<{ summary: string; source: 'ai' | 'rule-based' }> {
	try {
		const prompt = `As a PM, write a 2-3 sentence summary for this feedback digest:

Sentiment: Positive=${digestData.sentimentBreakdown.Positive}, Neutral=${digestData.sentimentBreakdown.Neutral}, Negative=${digestData.sentimentBreakdown.Negative}

Top themes: ${digestData.topThemes.slice(0, 3).map(t => `${t.theme} (${t.count})`).join(', ')}

Top priority items: ${digestData.needsAttention.slice(0, 3).map(item => `"${item.text}" (${item.theme}, priority ${item.priorityScore})`).join('; ')}

Focus on: overall sentiment, key themes, and suggested next action. Keep it concise and actionable.`;

		const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
			messages: [{ role: 'user', content: prompt }],
			temperature: 0.2,
			max_tokens: 150
		});

		const aiSummary = response.response?.trim();
		if (aiSummary && aiSummary.length > 20) {
			return { summary: aiSummary, source: 'ai' };
		}
	} catch (error) {
		console.error('AI summary generation failed:', error);
	}

	// Fallback to rule-based summary
	const total = digestData.sentimentBreakdown.Positive + digestData.sentimentBreakdown.Neutral + digestData.sentimentBreakdown.Negative;
	const negativeCount = digestData.sentimentBreakdown.Negative;
	const highUrgencyCount = digestData.needsAttention.filter(item => item.urgency === 'High').length;
	const topTheme = digestData.topThemes[0]?.theme || 'N/A';

	const ruleBasedSummary = negativeCount > total * 0.4 
		? `Critical issues need immediate attention: ${negativeCount} negative feedback items primarily around ${topTheme}. ${highUrgencyCount} high-urgency items require immediate action to prevent customer churn.`
		: `Feedback sentiment is generally stable with ${topTheme} as the primary theme. Focus on addressing ${digestData.needsAttention.length} high-priority items to improve overall satisfaction.`;

	return { summary: ruleBasedSummary, source: 'rule-based' };
}

async function generateDigest(filteredFeedback: FeedbackItem[], env: Env): Promise<Digest> {
	const total = filteredFeedback.length;
	
	const sentimentBreakdown = filteredFeedback.reduce((acc, item) => {
		acc[item.sentiment]++;
		return acc;
	}, { Positive: 0, Neutral: 0, Negative: 0 });

	const themeCounts = filteredFeedback.reduce((acc, item) => {
		acc[item.theme] = (acc[item.theme] || 0) + 1;
		return acc;
	}, {} as Record<string, number>);

	const topThemes = Object.entries(themeCounts)
		.sort(([, a], [, b]) => b - a)
		.slice(0, 5)
		.map(([theme, count]) => ({ theme, count }));

	const needsAttention = filteredFeedback
		.filter(item => item.priorityScore >= 70)
		.sort((a, b) => b.priorityScore - a.priorityScore)
		.slice(0, 5);

	// Generate AI summary with fallback
	const { summary: pmSummary, source: summarySource } = await generateAiSummary(env, {
		sentimentBreakdown,
		topThemes,
		needsAttention
	});

	return {
		generatedAt: new Date().toISOString(),
		total,
		sentimentBreakdown,
		topThemes,
		needsAttention,
		pmSummary,
		summarySource
	};
}

function generateHTML(digest: Digest, currentFilters: { sentiment?: string; theme?: string }, filteredFeedback: FeedbackItem[]): string {
	const filterParams = new URLSearchParams();
	if (currentFilters.sentiment) filterParams.set('sentiment', currentFilters.sentiment);
	if (currentFilters.theme) filterParams.set('theme', currentFilters.theme);
	const filterString = filterParams.toString();

	const apiLink = '/api' + (filterString ? `?${filterString}` : '');

	const feedbackItems = filteredFeedback.slice(0, 12);

	return `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Feedback Triage Digest</title>
	<style>
		body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
		.container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
		.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
		h1 { color: #333; margin: 0; }
		.header-actions { display: flex; gap: 10px; align-items: center; }
		.seed-btn { background: #10b981; color: white; padding: 10px 20px; border-radius: 6px; border: none; text-decoration: none; font-weight: 500; cursor: pointer; font-size: 14px; }
		.seed-btn:hover { background: #059669; }
		.view-api-btn { background: #3b82f6; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 500; }
		.view-api-btn:hover { background: #2563eb; }
		.last-updated { color: #666; margin-bottom: 20px; font-size: 14px; }
		.filter-info { background: #e5e7eb; padding: 15px; border-radius: 6px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
		.filter-text { font-weight: 500; color: #333; }
		.clear-filters { background: #6b7280; color: white; padding: 8px 16px; border-radius: 4px; text-decoration: none; font-size: 14px; }
		.clear-filters:hover { background: #4b5563; }
		.overview { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 30px; }
		.tile { padding: 20px; border-radius: 6px; text-align: center; cursor: pointer; transition: transform 0.1s; text-decoration: none; color: white; font-weight: bold; }
		.tile:hover { transform: translateY(-2px); }
		.positive { background: #22c55e; }
		.neutral { background: #f59e0b; }
		.negative { background: #ef4444; }
		.tile .count { font-size: 24px; display: block; margin-bottom: 5px; }
		.section { margin-bottom: 30px; }
		.section h2 { color: #333; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; }
		.themes { list-style: none; padding: 0; }
		.theme-item { padding: 10px; margin: 5px 0; background: #f8f9fa; border-radius: 4px; text-decoration: none; color: #333; display: flex; justify-content: space-between; }
		.theme-item:hover { background: #e9ecef; }
		.feedback-list { list-style: none; padding: 0; }
		.feedback-item { padding: 15px; margin: 10px 0; border: 1px solid #e5e7eb; border-radius: 6px; background: #fafafa; }
		.feedback-text { font-weight: 500; margin-bottom: 10px; color: #333; line-height: 1.4; }
		.feedback-meta { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; color: #666; margin-bottom: 8px; }
		.meta-item { background: #f3f4f6; padding: 4px 8px; border-radius: 4px; }
		.priority-score { color: #ef4444; font-weight: bold; font-size: 14px; }
		.needs-attention { list-style: none; padding: 0; }
		.need-item { padding: 15px; margin: 10px 0; border-left: 4px solid #ef4444; background: #fef2f2; border-radius: 4px; }
		.need-text { font-weight: 500; margin-bottom: 8px; color: #333; }
		.need-meta { font-size: 12px; color: #666; margin-bottom: 5px; }
		.summary { background: #f0f9ff; padding: 20px; border-radius: 6px; border-left: 4px solid #3b82f6; }
		.summary-source { font-size: 12px; color: #6b7280; margin-top: 10px; font-style: italic; }
		.sentiment-positive { color: #22c55e; font-weight: 500; }
		.sentiment-neutral { color: #f59e0b; font-weight: 500; }
		.sentiment-negative { color: #ef4444; font-weight: 500; }
		.urgency-high { color: #ef4444; font-weight: 500; }
		.urgency-medium { color: #f59e0b; font-weight: 500; }
		.urgency-low { color: #22c55e; font-weight: 500; }
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<h1>Feedback Triage Digest</h1>
			<div class="header-actions">
				<form method="POST" action="/seed" style="display: inline;">
					<button type="submit" class="seed-btn">Seed KV (demo)</button>
				</form>
				<a href="${apiLink}" class="view-api-btn">View JSON API</a>
			</div>
		</div>
		<div class="last-updated">Last updated: ${new Date(digest.generatedAt).toLocaleString()}</div>
		
		${filterString ? `
		<div class="filter-info">
			<div class="filter-text">Filters active: ${Array.from(filterParams.entries()).map(([k, v]) => `${k}=${v}`).join(', ')}</div>
			<a href="/ui" class="clear-filters">Clear filters</a>
		</div>

		<div class="section">
			<h2>Feedback List (${feedbackItems.length} items)</h2>
			<ul class="feedback-list">
				${feedbackItems.map(item => `
					<li class="feedback-item">
						<div class="feedback-text">"${item.text}"</div>
						<div class="feedback-meta">
							<span class="meta-item">Source: ${item.source}</span>
							<span class="meta-item">Theme: ${item.theme}</span>
							<span class="meta-item sentiment-${item.sentiment.toLowerCase()}">Sentiment: ${item.sentiment}</span>
							<span class="meta-item urgency-${item.urgency.toLowerCase()}">Urgency: ${item.urgency}</span>
						</div>
						<div class="priority-score">Priority Score: ${item.priorityScore}</div>
					</li>
				`).join('')}
			</ul>
		</div>
		` : ''}

		<div class="overview">
			<a href="/ui?sentiment=positive${currentFilters.theme ? '&theme=' + currentFilters.theme : ''}" class="tile positive">
				<span class="count">${digest.sentimentBreakdown.Positive}</span>
				Positive
			</a>
			<a href="/ui?sentiment=neutral${currentFilters.theme ? '&theme=' + currentFilters.theme : ''}" class="tile neutral">
				<span class="count">${digest.sentimentBreakdown.Neutral}</span>
				Neutral
			</a>
			<a href="/ui?sentiment=negative${currentFilters.theme ? '&theme=' + currentFilters.theme : ''}" class="tile negative">
				<span class="count">${digest.sentimentBreakdown.Negative}</span>
				Negative
			</a>
		</div>

		<div class="section">
			<h2>Top Themes (${digest.topThemes.length})</h2>
			<ul class="themes">
				${digest.topThemes.map(theme => `
					<li>
						<a href="/ui?theme=${encodeURIComponent(theme.theme)}${currentFilters.sentiment ? '&sentiment=' + currentFilters.sentiment : ''}" class="theme-item">
							<span>${theme.theme}</span>
							<span><strong>${theme.count}</strong> items</span>
						</a>
					</li>
				`).join('')}
			</ul>
		</div>

		<div class="section">
			<h2>Needs Attention (${digest.needsAttention.length})</h2>
			<ul class="needs-attention">
				${digest.needsAttention.map(item => `
					<li class="need-item">
						<div class="need-text">"${item.text}"</div>
						<div class="need-meta">Source: ${item.source} | Theme: ${item.theme} | Urgency: ${item.urgency}</div>
						<div class="priority-score">Priority Score: ${item.priorityScore}</div>
					</li>
				`).join('')}
			</ul>
		</div>

		<div class="section">
			<h2>PM Summary</h2>
			<div class="summary">
				${digest.pmSummary}
			</div>
			<div class="summary-source">Summary source: ${digest.summarySource === 'ai' ? 'AI' : 'Rule-based (fallback)'}</div>
		</div>
	</div>
</body>
</html>`;
}

function generateAPIPage(digest: Digest, currentFilters: { sentiment?: string; theme?: string }): string {
	const filterParams = new URLSearchParams();
	if (currentFilters.sentiment) filterParams.set('sentiment', currentFilters.sentiment);
	if (currentFilters.theme) filterParams.set('theme', currentFilters.theme);
	const filterString = filterParams.toString();

	return `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Feedback Triage Digest API (JSON)</title>
	<style>
		body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
		.container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
		.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
		h1 { color: #333; margin: 0; }
		.header-actions { display: flex; gap: 10px; align-items: center; }
		.back-btn { background: #6b7280; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 500; }
		.back-btn:hover { background: #4b5563; }
		.raw-btn { background: #8b5cf6; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 500; }
		.raw-btn:hover { background: #7c3aed; }
		.summary-source { font-size: 12px; color: #6b7280; margin-top: 10px; font-style: italic; }
		pre { background: #f8f9fa; padding: 20px; border-radius: 6px; overflow-x: auto; border: 1px solid #e5e7eb; font-size: 14px; line-height: 1.5; }
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<h1>Feedback Triage Digest API (JSON)</h1>
			<div class="header-actions">
				<a href="/digest${filterString ? '?' + filterString : ''}" class="raw-btn">View raw JSON</a>
				<a href="/ui${filterString ? '?' + filterString : ''}" class="back-btn">Back to dashboard</a>
			</div>
		</div>
		<div class="summary-source">Summary source: ${digest.summarySource === 'ai' ? 'AI' : 'Rule-based (fallback)'}</div>
		<pre>${JSON.stringify(digest, null, 2)}</pre>
	</div>
</body>
</html>`;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		
		if (request.method !== 'GET' && request.method !== 'POST') {
			return new Response('Method Not Allowed', { status: 405 });
		}

		if (url.pathname === '/') {
			return Response.redirect(`${url.origin}/ui`, 302);
		}

		if (url.pathname === '/seed' && request.method === 'POST') {
			try {
				await env.FEEDBACK_KV.put("feedback_items", JSON.stringify(mockFeedback));
				return new Response(JSON.stringify({ 
					ok: true, 
					message: "Seeded KV with mock feedback", 
					count: mockFeedback.length 
				}), {
					headers: { 'Content-Type': 'application/json' }
				});
			} catch (error) {
				return new Response(JSON.stringify({ 
					ok: false, 
					message: "Failed to seed KV" 
				}), { 
					status: 500,
					headers: { 'Content-Type': 'application/json' }
				});
			}
		}

		const sentimentParam = url.searchParams.get('sentiment')?.toLowerCase();
		const themeParam = url.searchParams.get('theme');

		const feedbackItems = await loadFeedbackItems(env);
		let filteredFeedback = feedbackItems.filter(item => {
			if (sentimentParam && item.sentiment.toLowerCase() !== sentimentParam) {
				return false;
			}
			if (themeParam && item.theme !== themeParam) {
				return false;
			}
			return true;
		});

		const digest = await generateDigest(filteredFeedback, env);
		const currentFilters = { sentiment: sentimentParam || undefined, theme: themeParam || undefined };

		await cacheDigest(env, digest);

		if (url.pathname === '/digest') {
			return new Response(JSON.stringify(digest, null, 2), {
				headers: { 'Content-Type': 'application/json' }
			});
		}

		if (url.pathname === '/ui') {
			return new Response(generateHTML(digest, currentFilters, filteredFeedback), {
				headers: { 'Content-Type': 'text/html' }
			});
		}

		if (url.pathname === '/api') {
			return new Response(generateAPIPage(digest, currentFilters), {
				headers: { 'Content-Type': 'text/html' }
			});
		}

		return new Response('Not Found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
