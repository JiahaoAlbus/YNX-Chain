const path = require('node:path');
const esbuild = require(process.env.SOCIAL_ESBUILD);
const stage = __dirname;
const react = process.env.SOCIAL_REACT;
esbuild.buildSync({entryPoints:[path.join(stage,'entry.tsx')],outfile:path.join(stage,'bundle.js'),bundle:true,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},alias:{'react-native':path.join(stage,'host.tsx'),'react':react,'react-dom/client':process.env.SOCIAL_REACT_DOM}});
