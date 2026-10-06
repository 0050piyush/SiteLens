// Technology fingerprints. Each rule matches against the homepage HTML, the
// external script URLs, response headers, cookie names, and <meta> tags.
// `version` capture groups (group 1) are reported when present.

const R = (name, cat, rule) => ({ name, cat, ...rule });

export const SIGNATURES = [
  // Analytics
  R('Google Analytics', 'Analytics', { script: /google-analytics\.com\/(analytics|ga)\.js|googletagmanager\.com\/gtag\/js/, html: /gtag\(\s*['"]config['"]\s*,\s*['"](G|UA)-/, cookies: /^_ga$/ }),
  R('Google Analytics 4', 'Analytics', { html: /['"]G-[A-Z0-9]{6,}['"]/ }),
  R('Adobe Analytics', 'Analytics', { script: /\/s_code\.js|omtrdc\.net|2o7\.net|AppMeasurement/i }),
  R('Matomo', 'Analytics', { script: /matomo\.js|piwik\.js/, html: /_paq\.push/ }),
  R('Plausible', 'Analytics', { script: /plausible\.io\/js/ }),
  R('Fathom', 'Analytics', { script: /cdn\.usefathom\.com/ }),
  R('Simple Analytics', 'Analytics', { script: /scripts\.simpleanalyticscdn\.com/ }),
  R('Umami', 'Analytics', { html: /data-website-id=["'][0-9a-f-]{36}["'][^>]*umami|umami[^>]*data-website-id/i }),
  R('Mixpanel', 'Analytics', { script: /cdn\.mxpnl\.com|mixpanel/, html: /mixpanel\.init\(/ }),
  R('Amplitude', 'Analytics', { script: /amplitude\.com|cdn\.amplitude/ }),
  R('Segment', 'Analytics', { script: /cdn\.segment\.(com|io)\/analytics\.js/, html: /analytics\.load\(["']/ }),
  R('Heap', 'Analytics', { script: /heap-\d+\.js|cdn\.heapanalytics\.com/ }),
  R('Hotjar', 'Analytics', { script: /static\.hotjar\.com/, html: /hjSiteSettings|_hjSettings/ }),
  R('Microsoft Clarity', 'Analytics', { script: /clarity\.ms\/tag/, html: /clarity\.ms\/tag/ }),
  R('FullStory', 'Analytics', { script: /fullstory\.com\/s\/fs\.js|edge\.fullstory\.com/ }),
  R('PostHog', 'Analytics', { script: /posthog/, html: /posthog\.init\(/ }),
  R('Yandex Metrica', 'Analytics', { script: /mc\.yandex\.ru\/metrika/ }),
  R('Cloudflare Web Analytics', 'Analytics', { script: /static\.cloudflareinsights\.com\/beacon/ }),
  R('Vercel Analytics', 'Analytics', { script: /\/_vercel\/insights\/script\.js|va\.vercel-scripts\.com/ }),
  R('Chartbeat', 'Analytics', { script: /static\.chartbeat\.com/ }),
  R('comScore', 'Analytics', { script: /sb\.scorecardresearch\.com/ }),
  R('Parse.ly', 'Analytics', { script: /cdn\.parsely\.com/ }),

  // Tag managers
  R('Google Tag Manager', 'Tag manager', { script: /googletagmanager\.com\/gtm\.js/, html: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/ }),
  R('Tealium', 'Tag manager', { script: /tags\.tiqcdn\.com/ }),
  R('Adobe Launch', 'Tag manager', { script: /assets\.adobedtm\.com/ }),

  // Advertising & marketing pixels
  R('Google AdSense', 'Advertising', { script: /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle/, html: /adsbygoogle/ }),
  R('Google Ad Manager', 'Advertising', { script: /securepubads\.g\.doubleclick\.net|googletagservices\.com\/tag\/js\/gpt\.js/ }),
  R('Google Ads', 'Advertising', { html: /['"]AW-\d{6,}['"]|googleadservices\.com\/pagead\/conversion/ }),
  R('Meta Pixel', 'Advertising', { script: /connect\.facebook\.net\/[^"']*\/fbevents\.js/, html: /fbq\(\s*['"]init['"]/ }),
  R('LinkedIn Insight', 'Advertising', { script: /snap\.licdn\.com\/li\.lms-analytics/, html: /_linkedin_partner_id/ }),
  R('TikTok Pixel', 'Advertising', { script: /analytics\.tiktok\.com/, html: /ttq\.load\(/ }),
  R('X (Twitter) Pixel', 'Advertising', { script: /static\.ads-twitter\.com\/uwt\.js/ }),
  R('Pinterest Tag', 'Advertising', { script: /s\.pinimg\.com\/ct\/core\.js/ }),
  R('Microsoft Advertising', 'Advertising', { script: /bat\.bing\.com\/bat\.js/ }),
  R('Criteo', 'Advertising', { script: /static\.criteo\.net|dynamic\.criteo\.com/ }),
  R('Taboola', 'Advertising', { script: /cdn\.taboola\.com/ }),
  R('Outbrain', 'Advertising', { script: /widgets\.outbrain\.com/ }),
  R('Amazon Ads', 'Advertising', { script: /amazon-adsystem\.com/ }),
  R('Prebid.js', 'Advertising', { script: /prebid[^/]*\.js/i, html: /pbjs\.que/ }),

  // CMS & site builders
  R('WordPress', 'CMS', { html: /\/wp-content\/|\/wp-includes\//, meta: { generator: /WordPress\s*([\d.]+)?/ }, headers: { link: /api\.w\.org/ } }),
  R('Drupal', 'CMS', { html: /Drupal\.settings|\/sites\/default\/files/, meta: { generator: /Drupal\s*([\d.]+)?/ }, headers: { 'x-generator': /Drupal/ } }),
  R('Joomla', 'CMS', { meta: { generator: /Joomla!?\s*([\d.]+)?/ }, html: /\/media\/jui\// }),
  R('Ghost', 'CMS', { meta: { generator: /Ghost\s*([\d.]+)?/ } }),
  R('Webflow', 'CMS', { html: /data-wf-page|data-wf-site/, meta: { generator: /Webflow/ } }),
  R('Wix', 'CMS', { html: /static\.wixstatic\.com|wix-bolt/, headers: { 'x-wix-request-id': /./ } }),
  R('Squarespace', 'CMS', { html: /static1\.squarespace\.com|Static\.SQUARESPACE_CONTEXT/ }),
  R('HubSpot CMS', 'CMS', { headers: { 'x-hs-hub-id': /./ }, meta: { generator: /HubSpot/ } }),
  R('Contentful', 'CMS', { html: /images\.ctfassets\.net|ctfassets\.net/ }),
  R('Sanity', 'CMS', { html: /cdn\.sanity\.io/ }),
  R('Strapi', 'CMS', { headers: { 'x-powered-by': /Strapi/ } }),
  R('Framer', 'CMS', { html: /framerusercontent\.com|framer-motion/, meta: { generator: /Framer/ } }),
  R('Medium', 'CMS', { html: /cdn-client\.medium\.com/ }),
  R('Substack', 'CMS', { html: /substackcdn\.com/ }),
  R('Blogger', 'CMS', { meta: { generator: /blogger/i } }),
  R('Adobe Experience Manager', 'CMS', { html: /\/etc\.clientlibs\/|\/content\/dam\// }),
  R('Sitecore', 'CMS', { html: /\/-\/media\//, cookies: /^SC_ANALYTICS_GLOBAL_COOKIE$/ }),

  // E-commerce
  R('Shopify', 'E-commerce', { html: /cdn\.shopify\.com|Shopify\.theme/, headers: { 'x-shopid': /./, 'x-shopify-stage': /./ } }),
  R('WooCommerce', 'E-commerce', { html: /woocommerce/, implies: ['WordPress'] }),
  R('Magento', 'E-commerce', { html: /Mage\.Cookies|\/static\/version\d+\/frontend\//, cookies: /^(frontend|X-Magento-Vary)$/ }),
  R('BigCommerce', 'E-commerce', { html: /cdn\d*\.bigcommerce\.com/ }),
  R('PrestaShop', 'E-commerce', { meta: { generator: /PrestaShop/ }, html: /prestashop/i }),
  R('Salesforce Commerce Cloud', 'E-commerce', { html: /demandware\.(static|store)|\/on\/demandware/ }),
  R('Stripe', 'Payments', { script: /js\.stripe\.com/ }),
  R('PayPal', 'Payments', { script: /paypal\.com\/sdk\/js|paypalobjects\.com/ }),
  R('Razorpay', 'Payments', { script: /checkout\.razorpay\.com/ }),
  R('Klarna', 'Payments', { script: /klarna(cdn|services)?\.(com|net)/ }),
  R('Afterpay', 'Payments', { script: /afterpay\.com|js\.afterpay/ }),

  // JavaScript frameworks
  R('React', 'JS framework', { html: /data-reactroot|__REACT_DEVTOOLS|react-dom(\.production)?(\.min)?\.js/, script: /react(-dom)?(\.production)?(\.min)?\.js/ }),
  R('Next.js', 'JS framework', { html: /__NEXT_DATA__|\/_next\/static\//, headers: { 'x-powered-by': /Next\.js/ }, implies: ['React'] }),
  R('Vue.js', 'JS framework', { html: /data-v-[0-9a-f]{8}|__VUE__|vue(\.runtime)?(\.global)?(\.prod)?(\.min)?\.js/ }),
  R('Nuxt', 'JS framework', { html: /__NUXT__|\/_nuxt\//, implies: ['Vue.js'] }),
  R('Angular', 'JS framework', { html: /ng-version="([\d.]+)"|<app-root/ }),
  R('AngularJS', 'JS framework', { html: /ng-app=|angular(\.min)?\.js/ }),
  R('Svelte', 'JS framework', { html: /class="[^"]*svelte-[a-z0-9]{6}/ }),
  R('SvelteKit', 'JS framework', { html: /__sveltekit|\/_app\/immutable\//, implies: ['Svelte'] }),
  R('Remix', 'JS framework', { html: /__remixContext|__remixManifest/, implies: ['React'] }),
  R('Gatsby', 'Static site generator', { html: /___gatsby|\/page-data\/app-data\.json/, meta: { generator: /Gatsby\s*([\d.]+)?/ }, implies: ['React'] }),
  R('Astro', 'Static site generator', { html: /<astro-island|astro-[a-z0-9]{8}/, meta: { generator: /Astro\s*v?([\d.]+)?/ } }),
  R('Hugo', 'Static site generator', { meta: { generator: /Hugo\s*([\d.]+)?/ } }),
  R('Jekyll', 'Static site generator', { meta: { generator: /Jekyll\s*v?([\d.]+)?/ } }),
  R('Docusaurus', 'Static site generator', { meta: { generator: /Docusaurus\s*v?([\d.]+)?/ } }),
  R('Ember.js', 'JS framework', { html: /ember-application|data-ember-extension/ }),
  R('Alpine.js', 'JS library', { html: /x-data=|alpinejs/ }),
  R('htmx', 'JS library', { html: /hx-(get|post|swap|target)=/, script: /htmx(\.min)?\.js/ }),
  R('jQuery', 'JS library', { script: /jquery[.-]?([\d.]+)?(\.slim)?(\.min)?\.js/i, html: /jquery[.-]([\d.]+)(\.min)?\.js/i }),
  R('Lodash', 'JS library', { script: /lodash(\.min)?\.js/ }),
  R('GSAP', 'JS library', { script: /gsap(\.min)?\.js|greensock/i }),
  R('three.js', 'JS library', { script: /three(\.module)?(\.min)?\.js/ }),
  R('Lottie', 'JS library', { script: /lottie(-player|-web)?(\.min)?\.js/ }),
  R('core-js', 'JS library', { html: /core-js/ }),
  R('Webpack', 'Build tool', { html: /webpackJsonp|__webpack_require__|webpackChunk/ }),
  R('Vite', 'Build tool', { html: /\/@vite\/client|type="module"[^>]*\/assets\/index-[\w-]{8}\.js/ }),

  // UI / CSS
  R('Bootstrap', 'UI framework', { html: /bootstrap(\.min)?\.(css|js)|class="[^"]*\b(navbar-expand|col-md-\d)/ }),
  R('Tailwind CSS', 'UI framework', { html: /class="[^"]*\b(?:sm|md|lg|xl):[a-z-]+-\d|tailwind/ }),
  R('Font Awesome', 'Font', { html: /font-?awesome|kit\.fontawesome\.com|fa-solid|class="fa[srb]? fa-/ }),
  R('Google Fonts', 'Font', { html: /fonts\.googleapis\.com|fonts\.gstatic\.com/ }),
  R('Adobe Fonts', 'Font', { html: /use\.typekit\.net|p\.typekit\.net/ }),
  R('Material UI', 'UI framework', { html: /MuiButton|Mui[A-Z][a-zA-Z]+-root/ }),
  R('Chakra UI', 'UI framework', { html: /chakra-ui|css-[a-z0-9]+[^>]*chakra/ }),

  // Servers, languages, platforms
  R('Nginx', 'Web server', { headers: { server: /nginx\/?([\d.]+)?/i } }),
  R('Apache', 'Web server', { headers: { server: /Apache\/?([\d.]+)?/i } }),
  R('Microsoft IIS', 'Web server', { headers: { server: /Microsoft-IIS\/?([\d.]+)?/i } }),
  R('LiteSpeed', 'Web server', { headers: { server: /LiteSpeed/i } }),
  R('Caddy', 'Web server', { headers: { server: /Caddy/i } }),
  R('OpenResty', 'Web server', { headers: { server: /openresty\/?([\d.]+)?/i } }),
  R('Envoy', 'Web server', { headers: { server: /envoy/i } }),
  R('Google Web Server', 'Web server', { headers: { server: /^gws$|^ESF$/i } }),
  R('PHP', 'Language', { headers: { 'x-powered-by': /PHP\/?([\d.]+)?/i }, cookies: /^PHPSESSID$/ }),
  R('ASP.NET', 'Language', { headers: { 'x-powered-by': /ASP\.NET/i, 'x-aspnet-version': /([\d.]+)/ }, cookies: /^ASP\.NET_SessionId$/, html: /__VIEWSTATE/ }),
  R('Express', 'Web framework', { headers: { 'x-powered-by': /Express/ } }),
  R('Ruby on Rails', 'Web framework', { meta: { 'csrf-param': /authenticity_token/ }, headers: { 'x-runtime': /^[\d.]+$/ } }),
  R('Django', 'Web framework', { html: /csrfmiddlewaretoken/, cookies: /^(csrftoken|django_language)$/ }),
  R('Laravel', 'Web framework', { cookies: /^laravel_session$/ }),
  R('Java', 'Language', { cookies: /^JSESSIONID$/ }),

  // Hosting, CDN, edge
  R('Cloudflare', 'CDN', { headers: { server: /cloudflare/i, 'cf-ray': /./ } }),
  R('Fastly', 'CDN', { headers: { 'x-served-by': /cache-/, 'fastly-debug-digest': /./, via: /varnish|fastly/i } }),
  R('Akamai', 'CDN', { headers: { 'x-akamai-transformed': /./, server: /AkamaiGHost|AkamaiNetStorage/i, 'akamai-grn': /./ } }),
  R('Amazon CloudFront', 'CDN', { headers: { 'x-amz-cf-id': /./, via: /CloudFront/i } }),
  R('Google Cloud CDN', 'CDN', { headers: { via: /1\.1 google/ } }),
  R('Azure Front Door', 'CDN', { headers: { 'x-azure-ref': /./ } }),
  R('Bunny CDN', 'CDN', { headers: { server: /BunnyCDN/i } }),
  R('jsDelivr', 'CDN', { script: /cdn\.jsdelivr\.net/ }),
  R('cdnjs', 'CDN', { script: /cdnjs\.cloudflare\.com/ }),
  R('unpkg', 'CDN', { script: /unpkg\.com/ }),
  R('Vercel', 'Hosting', { headers: { server: /Vercel/i, 'x-vercel-id': /./, 'x-vercel-cache': /./ } }),
  R('Netlify', 'Hosting', { headers: { server: /Netlify/i, 'x-nf-request-id': /./ } }),
  R('GitHub Pages', 'Hosting', { headers: { server: /GitHub\.com/i, 'x-github-request-id': /./ } }),
  R('Heroku', 'Hosting', { headers: { via: /vegur/i } }),
  R('Render', 'Hosting', { headers: { 'x-render-origin-server': /./, 'rndr-id': /./ } }),
  R('Fly.io', 'Hosting', { headers: { server: /Fly\//i, 'fly-request-id': /./ } }),
  R('Cloudflare Pages', 'Hosting', { headers: { 'cf-pages': /./ } }),
  R('Amazon S3', 'Hosting', { headers: { server: /AmazonS3/i, 'x-amz-request-id': /./ } }),
  R('Firebase Hosting', 'Hosting', { headers: { 'x-firebase-hosting': /./ } }),
  R('WP Engine', 'Hosting', { headers: { 'x-powered-by': /WP Engine/i, 'wpe-backend': /./ } }),
  R('Kinsta', 'Hosting', { headers: { 'x-kinsta-cache': /./ } }),
  R('Varnish', 'Cache', { headers: { via: /varnish/i, 'x-varnish': /./ } }),

  // Customer engagement
  R('Intercom', 'Live chat', { script: /widget\.intercom\.io|js\.intercomcdn\.com/, html: /intercomSettings/ }),
  R('Drift', 'Live chat', { script: /js\.driftt\.com/ }),
  R('Zendesk', 'Live chat', { script: /static\.zdassets\.com|zopim/ }),
  R('Crisp', 'Live chat', { script: /client\.crisp\.chat/ }),
  R('Tawk.to', 'Live chat', { script: /embed\.tawk\.to/ }),
  R('LiveChat', 'Live chat', { script: /cdn\.livechatinc\.com/ }),
  R('Freshchat', 'Live chat', { script: /wchat\.freshchat\.com/ }),
  R('HubSpot', 'Marketing automation', { script: /js\.hs-scripts\.com|js\.hs-analytics\.net|js\.hsforms\.net/ }),
  R('Marketo', 'Marketing automation', { script: /munchkin\.marketo\.net/ }),
  R('Mailchimp', 'Marketing automation', { script: /chimpstatic\.com|list-manage\.com/ }),
  R('Klaviyo', 'Marketing automation', { script: /static\.klaviyo\.com/ }),
  R('Pardot', 'Marketing automation', { html: /pi\.pardot\.com|piAId/ }),
  R('Braze', 'Marketing automation', { script: /js\.appboycdn\.com|braze/ }),
  R('OneSignal', 'Push notifications', { script: /cdn\.onesignal\.com/ }),
  R('Optimizely', 'A/B testing', { script: /cdn\.optimizely\.com/ }),
  R('VWO', 'A/B testing', { script: /dev\.visualwebsiteoptimizer\.com/ }),
  R('LaunchDarkly', 'A/B testing', { script: /launchdarkly/ }),

  // Consent / privacy
  R('OneTrust', 'Consent', { script: /cdn\.cookielaw\.org|optanon/i }),
  R('Cookiebot', 'Consent', { script: /consent\.cookiebot\.com/ }),
  R('Didomi', 'Consent', { script: /sdk\.privacy-center\.org/ }),
  R('Usercentrics', 'Consent', { script: /app\.usercentrics\.eu|usercentrics/ }),
  R('Osano', 'Consent', { script: /cmp\.osano\.com/ }),
  R('TrustArc', 'Consent', { script: /consent\.trustarc\.com/ }),
  R('Quantcast Choice', 'Consent', { script: /quantcast\.mgr\.consensu\.org|cmp\.quantcast\.com/ }),

  // Monitoring, security
  R('Sentry', 'Monitoring', { script: /browser\.sentry-cdn\.com|sentry/, html: /Sentry\.init\(/ }),
  R('Datadog RUM', 'Monitoring', { script: /datadoghq-browser-agent|browser-intake-datadoghq/ }),
  R('New Relic', 'Monitoring', { html: /NREUM|js-agent\.newrelic\.com/ }),
  R('Bugsnag', 'Monitoring', { script: /bugsnag/ }),
  R('LogRocket', 'Monitoring', { script: /cdn\.logrocket\.io|cdn\.lr-ingest/ }),
  R('reCAPTCHA', 'Security', { script: /google\.com\/recaptcha|recaptcha\/api\.js/ }),
  R('hCaptcha', 'Security', { script: /hcaptcha\.com\/1\/api\.js/ }),
  R('Cloudflare Turnstile', 'Security', { script: /challenges\.cloudflare\.com\/turnstile/ }),
  R('Cloudflare Bot Management', 'Security', { cookies: /^__cf_bm$/ }),
  R('Imperva', 'Security', { headers: { 'x-iinfo': /./, 'x-cdn': /Imperva|Incapsula/i } }),
  R('Sucuri', 'Security', { headers: { server: /Sucuri/i, 'x-sucuri-id': /./ } }),

  // Media, search, misc
  R('YouTube embed', 'Video', { html: /youtube(-nocookie)?\.com\/embed\// }),
  R('Vimeo', 'Video', { html: /player\.vimeo\.com/ }),
  R('Wistia', 'Video', { script: /fast\.wistia\.(com|net)/ }),
  R('Google Maps', 'Maps', { script: /maps\.googleapis\.com\/maps\/api/, html: /google\.com\/maps\/embed/ }),
  R('Mapbox', 'Maps', { script: /api\.mapbox\.com|mapbox-gl/ }),
  R('Algolia', 'Search', { script: /algolia(search)?(\.min)?\.js|algolianet\.com/, html: /algolia/ }),
  R('Disqus', 'Comments', { script: /disqus\.com\/embed\.js|\.disqus\.com/ }),
  R('Typeform', 'Forms', { script: /embed\.typeform\.com/ }),
  R('Calendly', 'Scheduling', { script: /assets\.calendly\.com/ }),
  R('Auth0', 'Authentication', { script: /cdn\.auth0\.com/ }),
  R('Clerk', 'Authentication', { script: /clerk\.(accounts\.dev|browser)/ }),
  R('Firebase', 'Backend', { script: /firebasejs|firebase-app/, html: /firebaseConfig|firebaseapp\.com/ }),
  R('Supabase', 'Backend', { html: /\.supabase\.co/ }),
  R('PWA', 'Platform', { html: /<link[^>]+rel=["']manifest["']/ }),
  R('AMP', 'Platform', { html: /<html[^>]+(⚡|\bamp\b)[^>]*>/ }),
  R('Open Graph', 'SEO', { html: /<meta[^>]+property=["']og:/ }),
  R('Schema.org', 'SEO', { html: /application\/ld\+json|itemscope/ }),
  R('HTTP/3', 'Protocol', { headers: { 'alt-svc': /h3/ } }),
];

const CATEGORY_ORDER = [
  'CMS', 'E-commerce', 'JS framework', 'Static site generator', 'Web framework', 'Language', 'UI framework',
  'JS library', 'Build tool', 'Analytics', 'Tag manager', 'Advertising', 'Marketing automation', 'A/B testing',
  'Live chat', 'Push notifications', 'Payments', 'Consent', 'Monitoring', 'Security', 'Authentication', 'Backend',
  'CDN', 'Hosting', 'Web server', 'Cache', 'Font', 'Video', 'Maps', 'Search', 'Comments', 'Forms', 'Scheduling',
  'Platform', 'Protocol', 'SEO',
];

function test(re, value) {
  if (value == null) return null;
  const m = re.exec(String(value));
  return m ? m : null;
}

export function detectTechnologies({ html, headers, cookies, scriptSrcs, meta }) {
  const found = new Map();
  const scripts = scriptSrcs.join('\n');
  const add = (sig, version, evidence) => {
    const prev = found.get(sig.name);
    if (prev) {
      if (!prev.version && version) prev.version = version;
      return;
    }
    found.set(sig.name, { name: sig.name, category: sig.cat, version: version || null, evidence });
  };

  for (const sig of SIGNATURES) {
    let m;
    if (sig.script && (m = test(sig.script, scripts))) add(sig, m[1], 'script');
    if (sig.html && (m = test(sig.html, html))) add(sig, sig.name === 'Angular' ? m[1] : null, 'html');
    if (sig.cookies && cookies.some((c) => sig.cookies.test(c))) add(sig, null, 'cookie');
    if (sig.headers) {
      for (const [h, re] of Object.entries(sig.headers)) {
        if ((m = test(re, headers[h]))) { add(sig, m[1], `header: ${h}`); break; }
      }
    }
    if (sig.meta) {
      for (const [k, re] of Object.entries(sig.meta)) {
        if ((m = test(re, meta[k]))) { add(sig, m[1], `meta: ${k}`); break; }
      }
    }
  }
  for (const sig of SIGNATURES) {
    if (found.has(sig.name) && sig.implies) {
      for (const name of sig.implies) {
        const implied = SIGNATURES.find((s) => s.name === name);
        if (implied && !found.has(name)) found.set(name, { name, category: implied.cat, version: null, evidence: `implied by ${sig.name}` });
      }
    }
  }
  // GA4 and the generic GA rule describe the same product; keep the specific one.
  if (found.has('Google Analytics 4')) found.delete('Google Analytics');

  const list = [...found.values()].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name),
  );
  const byCategory = {};
  for (const t of list) (byCategory[t.category] ||= []).push(t);
  return { count: list.length, list, byCategory };
}
