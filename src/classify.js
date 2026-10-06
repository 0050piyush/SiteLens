import { countryFromTld } from './util.js';

// Keyword-weighted topic classifier over title, description, headings and body text.
const CATEGORIES = {
  'News & Media': ['news', 'breaking', 'headlines', 'journalism', 'editorial', 'politics', 'opinion', 'reporter', 'newsletter', 'latest stories', 'world news', 'magazine', 'podcast'],
  'E-commerce & Shopping': ['shop', 'cart', 'checkout', 'buy now', 'free shipping', 'add to bag', 'add to cart', 'sale', 'discount', 'products', 'store', 'deals', 'order', 'returns'],
  'Technology & Software': ['software', 'developer', 'api', 'cloud', 'platform', 'saas', 'open source', 'code', 'devops', 'integration', 'sdk', 'documentation', 'ai', 'machine learning', 'data'],
  'Finance': ['bank', 'banking', 'invest', 'investment', 'loan', 'credit', 'mortgage', 'trading', 'stocks', 'crypto', 'insurance', 'finance', 'payments', 'wallet', 'interest rate'],
  'Social & Community': ['community', 'forum', 'friends', 'followers', 'share', 'post', 'profile', 'join the conversation', 'members', 'social network', 'discussions'],
  'Education & Reference': ['learn', 'course', 'courses', 'university', 'students', 'tutorial', 'education', 'academy', 'lessons', 'encyclopedia', 'research', 'school', 'certificate'],
  'Entertainment & Streaming': ['movies', 'music', 'watch', 'stream', 'episodes', 'series', 'videos', 'celebrity', 'tv shows', 'trailer', 'playlist', 'artists'],
  'Gaming': ['games', 'gaming', 'play now', 'multiplayer', 'esports', 'console', 'steam', 'gamers', 'walkthrough', 'mods'],
  'Travel & Hospitality': ['travel', 'hotel', 'hotels', 'flights', 'booking', 'vacation', 'destinations', 'trip', 'resort', 'car rental', 'airline'],
  'Health & Wellness': ['health', 'medical', 'doctor', 'patients', 'wellness', 'fitness', 'symptoms', 'clinic', 'pharmacy', 'nutrition', 'mental health', 'hospital'],
  'Food & Drink': ['recipe', 'recipes', 'restaurant', 'menu', 'cooking', 'food', 'delivery', 'chef', 'ingredients', 'dining'],
  'Sports': ['sports', 'football', 'soccer', 'basketball', 'cricket', 'nba', 'nfl', 'league', 'scores', 'fixtures', 'tennis', 'match'],
  'Business & Services': ['consulting', 'agency', 'services', 'clients', 'solutions', 'enterprise', 'b2b', 'contact sales', 'case studies', 'partners'],
  'Government & Nonprofit': ['government', 'ministry', 'department', 'public services', 'citizens', 'donate', 'nonprofit', 'charity', 'foundation', 'volunteer'],
  'Jobs & Careers': ['jobs', 'careers', 'hiring', 'resume', 'job search', 'recruiters', 'apply now', 'salary', 'remote jobs'],
  'Real Estate': ['real estate', 'homes for sale', 'apartments', 'rent', 'property', 'realtor', 'listings', 'mortgage calculator'],
  'Automotive': ['cars', 'vehicles', 'dealership', 'test drive', 'suv', 'ev', 'electric vehicle', 'auto parts'],
  'Search & Portals': ['search the web', 'search engine', 'web search', 'images', 'maps', 'email'],
  'Personal & Portfolio': ['portfolio', 'about me', 'my work', 'resume', 'cv', 'hire me', 'my projects', 'blog posts'],
};

const TECH_HINTS = {
  'E-commerce': 'E-commerce & Shopping',
  Payments: 'E-commerce & Shopping',
};

export function classify(extract, tech) {
  if (!extract) return { primary: null, scores: [] };
  const weighted = [
    [`${extract.title || ''} ${extract.meta.description || ''} ${extract.meta['og:site_name'] || ''} ${extract.meta.keywords || ''}`, 4],
    [Object.values(extract.headings).flat().join(' '), 2],
    [extract.textSample, 1],
  ];
  const scores = {};
  for (const [cat, words] of Object.entries(CATEGORIES)) {
    let s = 0;
    for (const [text, w] of weighted) {
      const lower = ` ${text.toLowerCase()} `;
      for (const word of words) {
        const re = new RegExp(`[^a-z]${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z]`, 'g');
        const hits = (lower.match(re) || []).length;
        s += Math.min(hits, 5) * w;
      }
    }
    scores[cat] = s;
  }
  for (const t of tech?.list || []) {
    const cat = TECH_HINTS[t.category];
    if (cat) scores[cat] += 12;
  }
  if (/news|article/i.test(extract.meta['og:type'] || '') || extract.jsonLdTypes.some((t) => /NewsArticle|NewsMediaOrganization/.test(t))) scores['News & Media'] += 15;
  if (extract.jsonLdTypes.some((t) => /^Product$|^Offer$|OnlineStore/.test(t))) scores['E-commerce & Shopping'] += 15;
  const ranked = Object.entries(scores).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((acc, [, s]) => acc + s, 0) || 1;
  return {
    primary: ranked[0]?.[0] || 'Uncategorized',
    scores: ranked.slice(0, 4).map(([category, s]) => ({ category, confidence: Math.round((s / total) * 100) })),
  };
}

const LANG_NAMES = new Intl.DisplayNames(['en'], { type: 'language' });
const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

function langName(code) {
  try { return LANG_NAMES.of(code); } catch { return code; }
}

/**
 * Where the audience probably is, from observable signals only: ccTLD,
 * declared language, hreflang alternates, currency and server location.
 */
export function audienceSignals(host, extract, dns) {
  const signals = [];
  const tldCountry = countryFromTld(host);
  if (tldCountry) signals.push({ type: 'Country TLD', value: tldCountry });
  if (extract?.lang) {
    const [lang, region] = extract.lang.split(/[-_]/);
    signals.push({ type: 'Page language', value: langName(lang) + (region ? ` (${safeRegion(region)})` : '') });
  }
  const markets = new Set();
  const languages = new Set();
  for (const h of extract?.hreflang || []) {
    if (h.lang === 'x-default') continue;
    const [lang, region] = h.lang.split('-');
    languages.add(langName(lang));
    if (region) markets.add(safeRegion(region));
  }
  if (languages.size) signals.push({ type: 'Localized languages', value: [...languages].slice(0, 12).join(', '), count: languages.size });
  if (markets.size) signals.push({ type: 'Targeted markets', value: [...markets].slice(0, 12).join(', '), count: markets.size });
  const text = extract?.textSample || '';
  const currencies = [['$', 'USD/other dollar'], ['€', 'EUR'], ['£', 'GBP'], ['₹', 'INR'], ['¥', 'JPY/CNY'], ['₩', 'KRW'], ['R$', 'BRL'], ['₽', 'RUB']]
    .map(([sym, code]) => [code, text.split(sym).length - 1]).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  if (currencies.length) signals.push({ type: 'Prices shown in', value: currencies.slice(0, 3).map(([c]) => c).join(', ') });
  if (dns?.network?.country) signals.push({ type: 'Server location', value: safeRegion(dns.network.country) });
  return { signals, international: languages.size > 1 || markets.size > 1 };
}

function safeRegion(code) {
  try { return REGION_NAMES.of(code.toUpperCase()) || code; } catch { return code; }
}
