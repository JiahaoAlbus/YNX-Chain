#pragma once
#include "product_root_contract_private.hpp"
#import <Foundation/Foundation.h>
namespace ynx::wallet::product {
inline ProductScopeDATA product_scope_from_verified_projection(NSDictionary*d){
 auto exact=[](id value,NSArray*keys){if(![value isKindOfClass:NSDictionary.class]||[value count]!=keys.count||![[NSSet setWithArray:[value allKeys]]isEqual:[NSSet setWithArray:keys]])throw std::runtime_error("PRODUCT_SOURCE_SCOPE_KEYS");};
 auto string=[](id value){if(![value isKindOfClass:NSString.class])throw std::runtime_error("PRODUCT_SOURCE_SCOPE_STRING");NSData*b=[value dataUsingEncoding:NSUTF8StringEncoding];if(!b||b.length>256)throw std::runtime_error("PRODUCT_SOURCE_SCOPE_STRING");return std::string((const char*)b.bytes,b.length);};
 exact(d,@[@"version",@"networkId",@"account",@"protectedResourceRef",@"operations",@"products"]);
 id v=d[@"version"];if(![v isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)v)==CFBooleanGetTypeID()||[v doubleValue]!=1.0)throw std::runtime_error("PRODUCT_SOURCE_SCOPE_VERSION");
 ProductScopeDATA out{1,string(d[@"networkId"]),string(d[@"account"]),string(d[@"protectedResourceRef"]),{}, {}};
 id operations=d[@"operations"],products=d[@"products"];
 if(![operations isKindOfClass:NSArray.class]||[operations count]>allowed_operations().size()||![products isKindOfClass:NSArray.class]||[products count]>64)throw std::runtime_error("PRODUCT_SOURCE_SCOPE_ARRAY");
 for(id op in operations)out.operations.push_back(string(op));
 for(id product in products){exact(product,@[@"productId",@"sourceOrder"]);out.products.push_back({string(product[@"productId"]),string(product[@"sourceOrder"])});}
 validate_scope_data(out);return out;
}
}
