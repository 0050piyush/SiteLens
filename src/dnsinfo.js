import dns from 'node:dns/promises';
import net from 'node:net';

const resolver = new dns.Resolver({ timeout: 4000, tries: 2 });

async function q(fn, name) {
  try {
    return await fn.call(resolver, name);
  } catch {
    return [];
  }
}

const MAIL_PROVIDERS = [
  [/aspmx\.l\.google\.com|googlemail\.com|smtp\.google\.com/i, 'Google Workspace'],
  [/mail\.protection\.outlook\.com|outlook\.com$/i, 'Microsoft 365'],
  [/zoho\.(com|eu|in)/i, 'Zoho Mail'],
  [/protonmail\.ch|proton\.me/i, 'Proton Mail'],
  [/mimecast/i, 'Mimecast'],
  [/pphosted\.com|ppe-hosted\.com/i, 'Proofpoint'],
  [/barracudanetworks\.com/i, 'Barracuda'],
  [/amazonaws\.com|amazonses\.com/i, 'Amazon SES / WorkMail'],
  [/messagingengine\.com/i, 'Fastmail'],
  [/yandex\.(net|ru)/i, 'Yandex Mail'],
  [/secureserver\.net/i, 'GoDaddy Email'],
  [/mailgun\.org/i, 'Mailgun'],
  [/icloud\.com/i, 'iCloud Mail'],
  [/improvmx\.com/i, 'ImprovMX'],
  [/forwardemail\.net/i, 'Forward Email'],
  [/cloudflare\.net|mx\.cloudflare/i, 'Cloudflare Email Routing'],
  [/hostinger/i, 'Hostinger Mail'],
  [/qq\.com/i, 'Tencent Exmail'],
];

const DNS_PROVIDERS = [
  [/\.ns\.cloudflare\.com$/i, 'Cloudflare'],
  [/awsdns/i, 'Amazon Route 53'],
  [/azure-dns/i, 'Azure DNS'],
  [/googledomains\.com|ns-cloud-[a-z]\d*\.googledomains|google\.com$/i, 'Google Cloud DNS'],
  [/domaincontrol\.com/i, 'GoDaddy'],
  [/nsone\.net/i, 'NS1'],
  [/ultradns/i, 'UltraDNS'],
  [/akam\.net|akamaiedge|akamai/i, 'Akamai Edge DNS'],
  [/dynect\.net/i, 'Oracle Dyn'],
  [/registrar-servers\.com/i, 'Namecheap'],
  [/digitalocean\.com/i, 'DigitalOcean'],
  [/vercel-dns\.com/i, 'Vercel'],
  [/netlify/i, 'Netlify'],
  [/dnsimple/i, 'DNSimple'],
  [/hetzner/i, 'Hetzner'],
  [/ovh\.net/i, 'OVHcloud'],
  [/wixdns\.net/i, 'Wix'],
  [/squarespacedns|squarespace/i, 'Squarespace'],
  [/name-services\.com|enom/i, 'Enom'],
  [/hostgator|websitewelcome/i, 'HostGator'],
  [/bluehost/i, 'Bluehost'],
  [/dnsmadeeasy/i, 'DNS Made Easy'],
  [/gandi\.net/i, 'Gandi'],
  [/he\.net/i, 'Hurricane Electric'],
  [/linode/i, 'Linode / Akamai'],
];

// TXT verification tokens reveal SaaS tools an organisation has connected
// to its domain. It is one of the most underrated competitive-intel signals.
const TXT_SERVICES = [
  [/^google-site-verification=/i, 'Google Search Console'],
  [/^facebook-domain-verification=/i, 'Meta Business'],
  [/^MS=ms\d+/i, 'Microsoft 365'],
  [/^apple-domain-verification=/i, 'Apple'],
  [/^atlassian-domain-verification=/i, 'Atlassian'],
  [/^docusign=/i, 'DocuSign'],
  [/^adobe-idp-site-verification=|^adobe-sign-verification=/i, 'Adobe'],
  [/^stripe-verification=/i, 'Stripe'],
  [/^globalsign-/i, 'GlobalSign'],
  [/^ZOOM_verify_/i, 'Zoom'],
  [/^slack-domain-verification=/i, 'Slack'],
  [/^hubspot-developer-verification=|^hubspot-site-verification/i, 'HubSpot'],
  [/^openai-domain-verification=/i, 'OpenAI'],
  [/^anthropic-domain-verification/i, 'Anthropic'],
  [/^miro-verification=/i, 'Miro'],
  [/^shopify-verification-code=/i, 'Shopify'],
  [/^pinterest-site-verification=/i, 'Pinterest'],
  [/^yandex-verification:/i, 'Yandex Webmaster'],
  [/^cisco-ci-domain-verification=/i, 'Cisco Webex'],
  [/^dropbox-domain-verification=/i, 'Dropbox'],
  [/^have-i-been-pwned-verification=/i, 'Have I Been Pwned'],
  [/^mongodb-site-verification=/i, 'MongoDB Atlas'],
  [/^postman-domain-verification=/i, 'Postman'],
  [/^smartsheet-site-validation=/i, 'Smartsheet'],
  [/^figma-domain-verification=/i, 'Figma'],
  [/^notion-domain-verification=|^_notion/i, 'Notion'],
  [/^canva-site-verification=/i, 'Canva'],
  [/^asana-verification=/i, 'Asana'],
  [/^krisp-domain-verification=/i, 'Krisp'],
  [/^onetrust-domain-verification=/i, 'OneTrust'],
  [/^teamviewer-sso-verification=/i, 'TeamViewer'],
  [/^status-page-domain-verification=/i, 'Atlassian Statuspage'],
  [/^loom-site-verification=/i, 'Loom'],
  [/^twilio-domain-verification=/i, 'Twilio'],
  [/^segment-site-verification=/i, 'Segment'],
  [/^intercom-domain-validation=/i, 'Intercom'],
  [/^wrike-verification=/i, 'Wrike'],
  [/^citrix-verification-code=/i, 'Citrix'],
  [/^gitlab-pages-verification-code=|^_gitlab-pages/i, 'GitLab'],
  [/^github-verification|^_github-challenge/i, 'GitHub'],
  [/^vercel/i, 'Vercel'],
  [/^netlify-verification/i, 'Netlify'],
  [/^brevo-code:|^Sendinblue-code:/i, 'Brevo'],
  [/^mailru-verification:/i, 'Mail.ru'],
  [/^bing/i, 'Bing Webmaster'],
  [/^tiktok-developers-site-verification=/i, 'TikTok'],
  [/^workplace-domain-verification=/i, 'Workplace from Meta'],
  [/^jamf-site-verification=/i, 'Jamf'],
  [/^knowbe4-site-verification=/i, 'KnowBe4'],
  [/^sophos-domain-verification=/i, 'Sophos'],
  [/^zapier-domain-verification-challenge=/i, 'Zapier'],
  [/^airtable-verification=/i, 'Airtable'],
  [/^clickup-domain-verification=/i, 'ClickUp'],
  [/^linear-domain-verification=/i, 'Linear'],
  [/^1password-site-verification=/i, '1Password'],
  [/^lastpass-verification-code=/i, 'LastPass'],
  [/^okta-/i, 'Okta'],
  [/^duo_sso_verification=/i, 'Duo'],
  [/^amazonses:/i, 'Amazon SES'],
  [/^mandrill_verify\./i, 'Mailchimp Transactional'],
  [/^mailjet-verification/i, 'Mailjet'],
  [/^sendgrid/i, 'SendGrid'],
  [/^ahrefs-site-verification_/i, 'Ahrefs'],
  [/^semrush-site-verification/i, 'Semrush'],
];

// SPF include: domains reveal which platforms send email on the domain's behalf.
const SPF_SENDERS = [
  [/_spf\.google\.com/i, 'Google Workspace'],
  [/spf\.protection\.outlook\.com/i, 'Microsoft 365'],
  [/sendgrid\.net/i, 'SendGrid'],
  [/mailgun\.org/i, 'Mailgun'],
  [/amazonses\.com/i, 'Amazon SES'],
  [/servers\.mcsv\.net/i, 'Mailchimp'],
  [/spf\.mandrillapp\.com/i, 'Mailchimp Transactional'],
  [/_spf\.salesforce\.com|exacttarget|cust-spf\.exacttarget/i, 'Salesforce'],
  [/mail\.zendesk\.com/i, 'Zendesk'],
  [/mktomail\.com/i, 'Marketo'],
  [/hubspotemail\.net|_spf\.hubspot/i, 'HubSpot'],
  [/emailsrvr\.com/i, 'Rackspace Email'],
  [/zoho\.(com|eu|in)/i, 'Zoho'],
  [/spf\.mtasv\.net/i, 'Postmark'],
  [/sparkpostmail\.com/i, 'SparkPost'],
  [/spf\.mailjet\.com/i, 'Mailjet'],
  [/sendinblue\.com|brevo/i, 'Brevo'],
  [/freshdesk\.com|freshemail/i, 'Freshdesk'],
  [/intercom\.io|intercom-mail/i, 'Intercom'],
  [/helpscoutemail\.com/i, 'Help Scout'],
  [/shopify_spf|spf\.shopify\.com/i, 'Shopify'],
  [/atlassian\.net|_spf\.atlassian/i, 'Atlassian'],
  [/customer\.io/i, 'Customer.io'],
  [/klaviyo/i, 'Klaviyo'],
  [/pphosted\.com/i, 'Proofpoint'],
  [/mimecast/i, 'Mimecast'],
  [/qualtrics/i, 'Qualtrics'],
  [/docusign/i, 'DocuSign'],
  [/greenhouse\.io/i, 'Greenhouse'],
  [/workday/i, 'Workday'],
  [/servicenow/i, 'ServiceNow'],
  [/smtp\.github\.com|_spf\.github/i, 'GitHub'],
];

const matchAll = (rules, value) => rules.filter(([re]) => re.test(value)).map(([, name]) => name);
const uniq = (arr) => [...new Set(arr)];

/** Team Cymru's DNS interface maps an IP to its ASN and network owner. */
async function asnLookup(ip) {
  if (!ip || !net.isIPv4(ip)) return null;
  const rev = ip.split('.').reverse().join('.');
  const origin = (await q(resolver.resolveTxt, `${rev}.origin.asn.cymru.com`))[0]?.join('');
  if (!origin) return null;
  const [asn, prefix, country, registry] = origin.split('|').map((s) => s.trim());
  const firstAsn = asn.split(' ')[0];
  const desc = (await q(resolver.resolveTxt, `AS${firstAsn}.asn.cymru.com`))[0]?.join('');
  const org = desc ? desc.split('|').at(-1).trim().replace(/,\s*[A-Z]{2}$/, '') : null;
  return { asn: Number(firstAsn), prefix, country, registry, org };
}

const HOSTING_BY_ORG = [
  [/AMAZON|AWS/i, 'Amazon Web Services'],
  [/GOOGLE/i, 'Google Cloud'],
  [/MICROSOFT|AZURE/i, 'Microsoft Azure'],
  [/CLOUDFLARE/i, 'Cloudflare'],
  [/FASTLY/i, 'Fastly'],
  [/AKAMAI|LINODE/i, 'Akamai'],
  [/DIGITALOCEAN/i, 'DigitalOcean'],
  [/HETZNER/i, 'Hetzner'],
  [/OVH/i, 'OVHcloud'],
  [/VERCEL/i, 'Vercel'],
  [/NETLIFY/i, 'Netlify'],
  [/GITHUB/i, 'GitHub'],
  [/AUTOMATTIC/i, 'Automattic'],
  [/SHOPIFY/i, 'Shopify'],
  [/SQUARESPACE/i, 'Squarespace'],
  [/WIX/i, 'Wix'],
  [/ORACLE/i, 'Oracle Cloud'],
  [/ALIBABA|ALIYUN/i, 'Alibaba Cloud'],
  [/TENCENT/i, 'Tencent Cloud'],
  [/VULTR|CHOOPA/i, 'Vultr'],
  [/FACEBOOK|META/i, 'Meta'],
  [/INCAPSULA|IMPERVA/i, 'Imperva'],
  [/GODADDY/i, 'GoDaddy'],
  [/UNIFIEDLAYER|BLUEHOST|NEWFOLD/i, 'Newfold Digital (Bluehost/HostGator)'],
  [/HOSTINGER/i, 'Hostinger'],
  [/IONOS|1&1/i, 'IONOS'],
  [/SCALEWAY|ONLINE S\.A\.S/i, 'Scaleway'],
];

export async function dnsInfo(domain) {
  const apex = domain;
  const [a, aaaa, mx, ns, txt, caa, dmarc, wwwCname, soa] = await Promise.all([
    q(resolver.resolve4, apex),
    q(resolver.resolve6, apex),
    q(resolver.resolveMx, apex),
    q(resolver.resolveNs, apex),
    q(resolver.resolveTxt, apex),
    q(resolver.resolveCaa, apex),
    q(resolver.resolveTxt, `_dmarc.${apex}`),
    q(resolver.resolveCname, `www.${apex}`),
    resolver.resolveSoa(apex).catch(() => null),
  ]);

  const txtFlat = txt.map((parts) => parts.join(''));
  const spf = txtFlat.find((t) => /^v=spf1/i.test(t)) || null;
  const dmarcRec = dmarc.map((p) => p.join('')).find((t) => /^v=DMARC1/i.test(t)) || null;
  const dmarcPolicy = dmarcRec ? (/;\s*p=(\w+)/i.exec(dmarcRec)?.[1] || null) : null;
  const mxHosts = mx.sort((x, y) => x.priority - y.priority).map((m) => m.exchange.toLowerCase());

  const ip = a[0] || null;
  const [network, ptr] = await Promise.all([
    asnLookup(ip).catch(() => null),
    ip ? resolver.reverse(ip).then((r) => r[0] || null).catch(() => null) : null,
  ]);
  const hostingProvider = network?.org ? (HOSTING_BY_ORG.find(([re]) => re.test(network.org))?.[1] || network.org) : null;

  return {
    a,
    aaaa,
    ipv6: aaaa.length > 0,
    mx: mxHosts,
    ns: ns.map((n) => n.toLowerCase()).sort(),
    txt: txtFlat,
    caa: caa.map((c) => ({ critical: c.critical, ...Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'critical')) })),
    soa: soa ? { primary: soa.nsname, admin: soa.hostmaster, serial: soa.serial } : null,
    wwwCname: wwwCname[0] || null,
    spf,
    dmarc: dmarcRec,
    dmarcPolicy,
    providers: {
      email: uniq(mxHosts.flatMap((h) => matchAll(MAIL_PROVIDERS, h))),
      dns: uniq(ns.flatMap((h) => matchAll(DNS_PROVIDERS, h))),
      hosting: hostingProvider,
      emailSenders: spf ? uniq(matchAll(SPF_SENDERS, spf)) : [],
      verifiedServices: uniq(txtFlat.flatMap((t) => matchAll(TXT_SERVICES, t))),
    },
    network: network ? { ...network, ip, ptr } : (ip ? { ip, ptr } : null),
  };
}
