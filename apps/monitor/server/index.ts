import { createApp } from './app.js';
const port=Number(process.env.YNX_MONITOR_PORT||4675);const app=await createApp();app.listen(port,'127.0.0.1',()=>console.log(`YNX Monitor control plane listening on http://127.0.0.1:${port}`));
