import type{WPRMaterializationDATA,WPRPublicMaterializationDATA}from'../src/original-wallet-product-materializer-data.js';
/** DATA only. A genuine independently acquired Native owner must fence this
 * call before and after; output never substitutes for that owner or Root. */
export declare function assembleOriginalWPRMaterializationDATA(actualNativeReply:unknown):Readonly<{data:WPRMaterializationDATA;result:WPRPublicMaterializationDATA;dataOnly:true;RootAdmission:false;SourceAdmission:false;NativeAdmission:false}>;
