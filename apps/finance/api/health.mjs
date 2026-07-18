export default function handler(_request,response){
  response.setHeader('Cache-Control','no-store');
  response.status(200).json({
    ok:true,
    service:'ynx-finance-web-companion',
    version:'1.2.0',
    surface:'signed-out-companion-only',
    financeAPI:false,
    walletAuth:false,
    commit:process.env.VERCEL_GIT_COMMIT_SHA||'unavailable',
    truthfulStatus:'web-feasibility-only'
  });
}
