const keys=['Wallet build','Build information unavailable.','Recorded package metadata only; this does not verify a signature or running features.'];
const rows={
 en:keys,
 'zh-Hans':['Wallet 构建信息','构建信息不可用。','仅显示包内记录的元数据，不代表签名或运行功能已验证。'],
 'zh-Hant':['Wallet 建置資訊','建置資訊無法取得。','僅顯示套件內記錄的中繼資料，不代表簽章或執行功能已驗證。'],
 ja:['Wallet ビルド情報','ビルド情報を取得できません。','パッケージ内の記録情報のみです。署名や実行機能の検証を意味しません。'],
 ko:['Wallet 빌드 정보','빌드 정보를 사용할 수 없습니다.','패키지에 기록된 메타데이터만 표시하며 서명이나 실행 기능의 검증을 의미하지 않습니다.'],
 es:['Compilación de Wallet','Información de compilación no disponible.','Solo metadatos del paquete; no verifica firmas ni funciones en ejecución.'],
 fr:['Compilation de Wallet','Informations de compilation indisponibles.','Métadonnées du paquet uniquement ; cela ne vérifie ni la signature ni les fonctions en cours d’exécution.'],
 de:['Wallet-Build','Build-Informationen nicht verfügbar.','Nur aufgezeichnete Paketmetadaten; keine Prüfung von Signatur oder laufenden Funktionen.'],
 pt:['Compilação da Wallet','Informações de compilação indisponíveis.','Apenas metadados do pacote; não verifica assinaturas nem funções em execução.'],
 ru:['Сборка Wallet','Информация о сборке недоступна.','Только метаданные пакета; это не проверка подписи или работающих функций.'],
 ar:['إصدار بناء Wallet','معلومات البناء غير متاحة.','بيانات الحزمة المسجلة فقط؛ لا تعني التحقق من التوقيع أو الميزات قيد التشغيل.'],
 id:['Build Wallet','Informasi build tidak tersedia.','Hanya metadata paket yang tercatat; bukan verifikasi tanda tangan atau fitur yang berjalan.']
};
export const BUILD_INFO_COPY=Object.freeze(Object.fromEntries(Object.entries(rows).map(([locale,values])=>{
 if(values.length!==keys.length||values.some(v=>!v))throw Error('Incomplete build information copy');
 return[locale,Object.freeze(Object.fromEntries(keys.map((key,i)=>[key,values[i]])))];
})));
