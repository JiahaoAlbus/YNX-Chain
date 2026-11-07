#!/usr/bin/env node
import {selectReviewedWalletProductMaterialization} from '../src/original-wallet-product-materializer-data.js';
try{if(process.argv.length!==2)throw Object.assign(Error('WPR_NORMAL_ZERO_ARGUMENTS_REQUIRED'),{code:'WPR_NORMAL_ZERO_ARGUMENTS_REQUIRED'});const result=selectReviewedWalletProductMaterialization();process.stdout.write(result.manifestOriginal+'\n');}catch(e){process.stderr.write(JSON.stringify({code:typeof e?.code==='string'?e.code:'WPR_MATERIALIZATION_UNKNOWN',RootAdmission:false,SourceAdmission:false,keysOpened:false})+'\n');process.exitCode=1;}
