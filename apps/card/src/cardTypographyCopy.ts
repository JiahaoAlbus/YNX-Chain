import type {Locale} from './i18n';
const labels:Readonly<Record<Locale,readonly [string,string,string,string,string,string]>>={
  en:['Text size','Compact','Standard','Larger','Also follows your device text size.','Applied now; this device could not save the preference.'],
  'zh-CN':['文字大小','紧凑','标准','较大','同时遵循设备的文字大小。','已在当前界面应用，但设备未能保存此偏好。'],
  'zh-TW':['文字大小','精簡','標準','較大','同時遵循裝置的文字大小。','已套用於目前介面，但裝置無法儲存此偏好。'],
  ja:['文字サイズ','コンパクト','標準','大きめ','端末の文字サイズ設定も反映します。','現在の画面には適用されましたが、端末に保存できませんでした。'],
  ko:['글자 크기','작게','표준','크게','기기의 글자 크기 설정도 따릅니다.','현재 화면에 적용했지만 기기에 저장하지 못했습니다.'],
  es:['Tamaño del texto','Compacto','Estándar','Grande','También respeta el tamaño de texto del dispositivo.','Aplicado ahora; no se pudo guardar la preferencia en este dispositivo.'],
  fr:['Taille du texte','Compacte','Standard','Grande','Respecte aussi la taille du texte de votre appareil.','Appliqué maintenant ; la préférence n’a pas pu être enregistrée sur cet appareil.'],
  de:['Textgröße','Kompakt','Standard','Größer','Beachtet auch die Textgröße Ihres Geräts.','Jetzt angewendet; die Einstellung konnte auf diesem Gerät nicht gespeichert werden.'],
  pt:['Tamanho do texto','Compacto','Padrão','Maior','Também respeita o tamanho do texto do dispositivo.','Aplicado agora; não foi possível salvar a preferência neste dispositivo.'],
  ru:['Размер текста','Компактный','Стандартный','Крупный','Также учитывается размер текста на устройстве.','Применено сейчас; сохранить настройку на устройстве не удалось.'],
  ar:['حجم النص','مضغوط','قياسي','أكبر','يراعي أيضًا حجم النص المحدد على جهازك.','تم التطبيق الآن، لكن تعذّر حفظ التفضيل على هذا الجهاز.'],
  id:['Ukuran teks','Ringkas','Standar','Lebih besar','Juga mengikuti ukuran teks perangkat Anda.','Diterapkan sekarang; perangkat ini tidak dapat menyimpan preferensi.'],
};
export function cardTypographyCopy(locale:Locale){return labels[locale]}
