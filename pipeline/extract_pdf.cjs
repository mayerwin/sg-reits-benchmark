// extract text from PDF URL or local file
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const pdfParse = require('pdf-parse-fork');

function download(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307) {
        let loc = res.headers.location;
        if (loc && !loc.startsWith('http')) {
          const u = new URL(url);
          loc = u.protocol + '//' + u.host + (loc.startsWith('/') ? loc : '/' + loc);
        }
        return download(loc).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const input = process.argv[2];
  const search = process.argv[3]; // optional regex to filter lines
  if (!input) {
    console.error('Usage: node extract_pdf.js <url-or-path> [searchRegex]');
    process.exit(2);
  }
  let buf;
  if (input.startsWith('http')) {
    buf = await download(input);
  } else {
    buf = fs.readFileSync(input);
  }
  const data = await pdfParse(buf);
  let text = data.text;
  if (search) {
    const re = new RegExp(search, 'i');
    text = text.split('\n').filter(l => re.test(l)).join('\n');
  }
  console.log(text);
}

main().catch(e => { console.error(e); process.exit(1); });
