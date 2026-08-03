const flag = process.argv.indexOf('--base-url');
const base = (flag >= 0 ? process.argv[flag + 1] : '') || process.env.YNX_SHOP_URL || 'http://127.0.0.1:8095';
for (const path of ['/health', '/api/capabilities']) {
  const response = await fetch(base + path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  console.log(path, 'OK');
}
