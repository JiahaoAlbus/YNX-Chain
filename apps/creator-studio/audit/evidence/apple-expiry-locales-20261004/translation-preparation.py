import json,pathlib
p=pathlib.Path('apps/creator-studio/ios/YNXCreator/catalog.json');j=json.loads(p.read_text());keys=[k for k in j['en'] if k not in j['ja']]
translations={
'zh-TW':'''申訴與爭議
提交理由供人工審核。申訴不會恢復發布或確認付款。已儲存的請求可依最新記錄恢復。
可存取的影片目前沒有舉報。
提交申訴
提出收益記錄爭議
理由（最多 2,000 個字元）
先預覽 PNG、JPEG 或 WebP 縮圖（最多 5 MiB），或 UTF-8 WebVTT 字幕檔（最多 1 MiB），再明確選擇上傳。字幕會標示為已人工核准。已儲存的上傳保留在原帳號下。
縮圖
字幕
已人工核准
需要人工審核
字幕語言標籤
字幕名稱
選擇檔案並預覽
上傳此檔案
重試已儲存的素材上傳
取消素材上傳
請檢查檔案格式、大小、字幕語言與名稱。檔案變更後必須重新預覽。
素材上傳尚未確認。請查看最新記錄，再重試已儲存的上傳。
素材已儲存；已驗證原伺服器位元組。
我已審閱此字幕檔，並核准將它用於這部影片。
檢查 AI 服務
AI Gateway 已設定。每個結果會記錄其供應商與模型。
AI 服務無法使用。現有已儲存的任務會保留。
AI 服務狀態尚未確認。請先檢查再核准執行。
先建立任務以查看原始內容預覽、輸出語言與預估用量。執行需要另行核准。
選擇影片
任務
輸出語言
允許使用中繼資料作為上下文
允許使用字幕作為上下文
建立上下文預覽
已儲存的任務
選擇已儲存的任務
開啟原始已儲存任務
共用上下文預覽
預估用量
正在等待原始任務串流…
尚無已儲存的結果。
建議需要您審核。接受建議不會發布影片或變更其權利。
查看原始任務狀態
核准此上下文並執行
取消 AI 任務
接受建議
拒絕建議
刪除上下文與結果
要刪除此 AI 任務已儲存的上下文與結果嗎？影片內容與權利會保留。
無法確認此原始已儲存任務。請檢查連線後重試。
此任務正在執行或需要恢復。請查看其原始已儲存狀態，不要另建替代任務。
取消尚未確認。請重試已儲存的取消請求，以查看原始任務。
已確認原始任務取消。
任務已完成。結果仍可供審核。
重試已儲存的 AI 取消請求
摘要
章節
字幕
中繼資料
搜尋協助
內容審核說明
等待您核准
執行中
需要您審核
已接受建議
已拒絕建議
已取消
需要恢復
收益所有者
獨占授權
設定權利開始日期
設定權利結束日期
權利開始時間
權利結束時間
貢獻者與分成
每位貢獻者的 YNX 帳號只能填一次。分成合計必須為 100%，最多兩位小數。
貢獻者 YNX 帳號
分成（%）
移除貢獻者
新增貢獻者
請檢查權利資料、未來到期時間、證據雜湊，以及合計為 100% 的貢獻者分成。
版本記錄
設定邀請有效期
邀請到期時間
授權版本
聲明帳號
原始素材 SHA-256
審核帳號
是
否''',
'ja':'''異議申し立てと紛争
人による審査のために理由を提出してください。異議申し立てでは公開は復旧せず、支払いも確認されません。保存済みのリクエストは最新の記録から復旧できます。
アクセス可能な動画への通報はありません。
異議を申し立てる
収益記録に異議を申し立てる
理由（最大 2,000 文字）
PNG、JPEG、WebP のサムネイル（最大 5 MiB）、または UTF-8 WebVTT 字幕ファイル（最大 1 MiB）をプレビューし、明示的にアップロードしてください。字幕は人による承認済みとして記録されます。保存済みのアップロードは元のアカウントに保持されます。
サムネイル
字幕
人による承認済み
人による審査が必要
字幕の言語タグ
字幕名
ファイルを選んでプレビュー
このファイルをアップロード
保存済みの素材アップロードを再試行
素材アップロードをキャンセル
ファイル形式、サイズ、字幕言語と名前を確認してください。変更したファイルは再度プレビューが必要です。
素材アップロードは未確認です。最新の記録を確認し、保存済みのアップロードを再試行してください。
素材を保存し、元のサーバーバイト列を検証しました。
この字幕ファイルを確認し、この動画への使用を承認します。
AI サービスを確認
AI Gateway は設定済みです。各結果に提供元とモデルが記録されます。
AI サービスは利用できません。既存の保存済みタスクは保持されます。
AI サービスの状態は未確認です。実行を承認する前に確認してください。
タスクを準備して、元のコンテキスト、出力言語と予想使用量を確認してください。実行には別途承認が必要です。
動画を選択
タスク
出力言語
メタデータのコンテキストを許可
字幕のコンテキストを許可
コンテキストのプレビューを準備
保存済みタスク
保存済みタスクを選択
元の保存済みタスクを開く
共有コンテキストのプレビュー
予想使用量
元のタスクストリームを待機中…
保存済みの結果はまだありません。
提案にはあなたの確認が必要です。提案を採用しても動画は公開されず、権利も変更されません。
元のタスクの状態を確認
このコンテキストを承認して実行
AI タスクをキャンセル
提案を採用
提案を却下
コンテキストと結果を削除
この AI タスクの保存済みコンテキストと結果を削除しますか？動画の内容と権利は保持されます。
元の保存済みタスクを確認できませんでした。接続を確認して再試行してください。
このタスクは実行中か、復旧が必要です。元の保存状態を確認し、代替タスクを作成しないでください。
キャンセルは未確認です。保存済みのキャンセル要求を再試行して元のタスクを確認してください。
元のタスクのキャンセルを確認しました。
タスクは既に完了しています。結果は引き続き確認できます。
保存済みの AI キャンセルを再試行
要約
チャプター
字幕
メタデータ
検索支援
コンテンツ審査の説明
あなたの承認待ち
実行中
あなたの確認が必要
提案を採用済み
提案を却下済み
キャンセル済み
復旧が必要
収益の所有者
独占ライセンス
権利の開始日を設定
権利の終了日を設定
権利の開始
権利の終了
貢献者と分配率
各貢献者の YNX アカウントは一度だけ入力してください。分配率の合計は 100%、小数点以下は最大 2 桁です。
貢献者の YNX アカウント
分配率（%）
貢献者を削除
貢献者を追加
権利の詳細、将来の有効期限、証拠ハッシュと合計 100% の分配率を確認してください。
バージョン履歴
招待の有効期限を設定
招待の有効期限
認可バージョン
申告者
元の素材 SHA-256
審査者
はい
いいえ''',
'ko':'''이의 신청 및 분쟁
사람이 검토할 수 있도록 사유를 제출하세요. 이의 신청은 게시를 복원하거나 결제를 확인하지 않습니다. 저장된 요청은 최신 기록에서 복구할 수 있습니다.
접근 가능한 동영상에 신고가 없습니다.
이의 신청 제출
수익 기록에 이의 제기
사유(최대 2,000자)
PNG, JPEG, WebP 썸네일(최대 5 MiB) 또는 UTF-8 WebVTT 자막 파일(최대 1 MiB)을 미리 본 뒤 명시적으로 업로드하세요. 자막은 사람이 승인한 것으로 기록됩니다. 저장된 업로드는 원래 계정에 보관됩니다.
썸네일
자막
사람이 승인함
사람의 검토 필요
자막 언어 태그
자막 이름
미리 볼 파일 선택
이 파일 업로드
저장된 자료 업로드 재시도
자료 업로드 취소
파일 형식, 크기, 자막 언어와 이름을 확인하세요. 변경된 파일은 다시 미리 봐야 합니다.
자료 업로드가 확인되지 않았습니다. 최신 기록을 확인한 후 저장된 업로드를 재시도하세요.
자료가 저장되었으며 원래 서버 바이트를 검증했습니다.
이 자막 파일을 검토했으며 이 동영상에 사용하도록 승인합니다.
AI 서비스 확인
AI Gateway가 설정되었습니다. 각 결과에 제공 업체와 모델이 기록됩니다.
AI 서비스를 사용할 수 없습니다. 기존 저장된 작업은 유지됩니다.
AI 서비스 상태가 확인되지 않았습니다. 실행을 승인하기 전에 확인하세요.
작업을 준비하여 원래 맥락 미리보기, 출력 언어와 예상 사용량을 확인하세요. 실행은 별도로 승인해야 합니다.
동영상 선택
작업
출력 언어
메타데이터 맥락 사용 허용
자막 맥락 사용 허용
맥락 미리보기 준비
저장된 작업
저장된 작업 선택
원래 저장된 작업 열기
공유 맥락 미리보기
예상 사용량
원래 작업 스트림을 기다리는 중…
아직 저장된 결과가 없습니다.
제안은 검토가 필요합니다. 제안을 수락해도 동영상을 게시하거나 권리를 변경하지 않습니다.
원래 작업 상태 확인
이 맥락을 승인하고 실행
AI 작업 취소
제안 수락
제안 거절
맥락 및 결과 삭제
이 AI 작업의 저장된 맥락과 결과를 삭제할까요? 동영상 내용과 권리는 유지됩니다.
원래 저장된 작업을 확인할 수 없습니다. 연결을 확인하고 재시도하세요.
작업이 실행 중이거나 복구가 필요합니다. 원래 저장된 상태를 확인하고 대체 작업을 시작하지 마세요.
취소가 확인되지 않았습니다. 저장된 취소 요청을 재시도하여 원래 작업을 확인하세요.
원래 작업의 취소가 확인되었습니다.
작업이 이미 완료되었습니다. 결과는 계속 검토할 수 있습니다.
저장된 AI 취소 재시도
요약
챕터
자막
메타데이터
검색 지원
콘텐츠 검토 설명
승인 대기 중
실행 중
검토 필요
제안 수락됨
제안 거절됨
취소됨
복구 필요
수익 소유자
독점 라이선스
권리 시작일 설정
권리 종료일 설정
권리 시작
권리 종료
기여자 및 배분율
각 기여자의 YNX 계정은 한 번만 입력하세요. 배분율 합계는 100%이며 소수점 둘째 자리까지 입력할 수 있습니다.
기여자 YNX 계정
배분율(%)
기여자 제거
기여자 추가
권리 세부 사항, 미래 만료일, 증거 해시와 합계가 100%인 배분율을 확인하세요.
버전 기록
초대 만료일 설정
초대 만료일
권한 버전
신고 계정
원본 자료 SHA-256
검토 계정
예
아니요''',
'es':'''Apelaciones y disputas
Envía un motivo para revisión humana. Una apelación no restablece la publicación ni confirma el pago. Las solicitudes guardadas se pueden recuperar desde los registros más recientes.
No hay denuncias en tus vídeos accesibles.
Enviar apelación
Disputar registro de ingresos
Motivo (hasta 2.000 caracteres)
Previsualiza una miniatura PNG, JPEG o WebP (hasta 5 MiB), o un archivo de subtítulos WebVTT en UTF-8 (hasta 1 MiB), y confirma su subida. Los subtítulos se marcarán como aprobados por una persona. Las subidas guardadas permanecen en su cuenta original.
Miniatura
Subtítulos
Aprobado por una persona
Requiere revisión humana
Etiqueta de idioma de los subtítulos
Nombre de los subtítulos
Elegir archivo para previsualizar
Subir este archivo
Reintentar subida de recurso guardada
Cancelar subida del recurso
Comprueba el formato, tamaño, idioma y nombre de los subtítulos. Si el archivo cambia, debes previsualizarlo de nuevo.
La subida del recurso no está confirmada. Consulta los registros más recientes y reintenta la subida guardada.
Recurso guardado; bytes originales del servidor verificados.
He revisado este archivo de subtítulos y apruebo su uso en este vídeo.
Comprobar servicio de IA
AI Gateway está configurado. Cada resultado registra su proveedor y modelo.
El servicio de IA no está disponible. Se conservan las tareas guardadas.
El estado del servicio de IA no está confirmado. Compruébalo antes de aprobar la ejecución.
Prepara una tarea para consultar su contexto original, idioma de salida y unidades estimadas. La ejecución requiere una aprobación independiente.
Elegir vídeo
Tarea
Idioma de salida
Permitir contexto de metadatos
Permitir contexto de subtítulos
Preparar vista previa del contexto
Tareas guardadas
Elegir tarea guardada
Abrir tarea original guardada
Vista previa del contexto compartido
Unidades estimadas
Esperando el flujo de la tarea original…
Aún no hay resultados guardados.
Debes revisar las sugerencias. Aceptar una sugerencia no publica un vídeo ni modifica sus derechos.
Comprobar estado de la tarea original
Aprobar este contexto y ejecutar
Cancelar tarea de IA
Aceptar sugerencia
Rechazar sugerencia
Eliminar contexto y resultado
¿Eliminar el contexto y el resultado guardados de esta tarea de IA? Se conservarán el contenido del vídeo y sus derechos.
No se pudo confirmar esta tarea original guardada. Comprueba la conexión y vuelve a intentarlo.
Esta tarea se está ejecutando o requiere recuperación. Consulta su estado original guardado; no crees una tarea de sustitución.
La cancelación no está confirmada. Reintenta la cancelación guardada para comprobar la tarea original.
Cancelación de la tarea original confirmada.
La tarea ya terminó. Su resultado sigue disponible para revisión.
Reintentar cancelación de IA guardada
Resumen
Capítulos
Subtítulos
Metadatos
Ayuda de búsqueda
Explicación de moderación
Pendiente de tu aprobación
En ejecución
Requiere tu revisión
Sugerencia aceptada
Sugerencia rechazada
Cancelada
Requiere recuperación
Titular de los ingresos
Licencia exclusiva
Definir fecha de inicio de derechos
Definir fecha de fin de derechos
Inicio de derechos
Fin de derechos
Colaboradores y porcentajes
Introduce una sola vez la cuenta YNX de cada colaborador. Los porcentajes deben sumar el 100%, con hasta dos decimales.
Cuenta YNX del colaborador
Porcentaje (%)
Eliminar colaborador
Añadir colaborador
Comprueba los derechos, la fecha de vencimiento futura, el hash de la prueba y los porcentajes que deben sumar el 100%.
Historial de versiones
Elegir vencimiento de la invitación
Vencimiento de la invitación
Versión de autorización
Declarado por
SHA-256 del archivo original
Revisado por
Sí
No''',
'fr':'''Recours et litiges
Indiquez un motif pour un examen humain. Un recours ne rétablit pas la publication et ne confirme pas le paiement. Les demandes enregistrées peuvent être récupérées à partir des derniers enregistrements.
Aucun signalement sur vos vidéos accessibles.
Déposer un recours
Contester un relevé de revenus
Motif (2 000 caractères maximum)
Prévisualisez une miniature PNG, JPEG ou WebP (5 MiB maximum), ou un fichier de sous-titres WebVTT en UTF-8 (1 MiB maximum), puis confirmez son envoi. Les sous-titres seront marqués comme approuvés par une personne. Les envois enregistrés restent liés au compte d’origine.
Miniature
Sous-titres
Approuvé par une personne
Examen humain requis
Code de langue des sous-titres
Nom des sous-titres
Choisir un fichier à prévisualiser
Envoyer ce fichier
Réessayer l’envoi enregistré du fichier
Annuler l’envoi du fichier
Vérifiez le format, la taille, la langue et le nom des sous-titres. Un fichier modifié doit être prévisualisé à nouveau.
L’envoi du fichier n’est pas confirmé. Consultez les derniers enregistrements, puis réessayez l’envoi enregistré.
Fichier enregistré ; octets du serveur d’origine vérifiés.
J’ai vérifié ce fichier de sous-titres et j’approuve son utilisation pour cette vidéo.
Vérifier le service d’IA
AI Gateway est configuré. Chaque résultat indique son fournisseur et son modèle.
Le service d’IA est indisponible. Les tâches déjà enregistrées sont conservées.
L’état du service d’IA n’est pas confirmé. Vérifiez-le avant d’approuver l’exécution.
Préparez une tâche pour examiner son contexte d’origine, sa langue de sortie et les unités estimées. L’exécution nécessite une approbation distincte.
Choisir une vidéo
Tâche
Langue de sortie
Autoriser le contexte des métadonnées
Autoriser le contexte des sous-titres
Préparer l’aperçu du contexte
Tâches enregistrées
Choisir une tâche enregistrée
Ouvrir la tâche d’origine enregistrée
Aperçu du contexte partagé
Unités estimées
En attente du flux de la tâche d’origine…
Aucun résultat enregistré pour le moment.
Les suggestions nécessitent votre examen. Accepter une suggestion ne publie pas la vidéo et ne modifie pas ses droits.
Vérifier l’état de la tâche d’origine
Approuver ce contexte et exécuter
Annuler la tâche d’IA
Accepter la suggestion
Refuser la suggestion
Supprimer le contexte et le résultat
Supprimer le contexte et le résultat enregistrés de cette tâche d’IA ? Le contenu de la vidéo et ses droits seront conservés.
Impossible de confirmer cette tâche d’origine enregistrée. Vérifiez votre connexion et réessayez.
Cette tâche est en cours ou nécessite une récupération. Vérifiez son état d’origine enregistré ; ne créez pas de tâche de remplacement.
L’annulation n’est pas confirmée. Réessayez l’annulation enregistrée pour vérifier la tâche d’origine.
Annulation de la tâche d’origine confirmée.
La tâche est déjà terminée. Son résultat reste disponible pour examen.
Réessayer l’annulation d’IA enregistrée
Résumé
Chapitres
Sous-titres
Métadonnées
Aide à la recherche
Explication de modération
En attente de votre approbation
En cours
Votre examen est requis
Suggestion acceptée
Suggestion refusée
Annulée
Récupération requise
Titulaire des revenus
Licence exclusive
Définir le début des droits
Définir la fin des droits
Début des droits
Fin des droits
Contributeurs et parts
Saisissez une seule fois le compte YNX de chaque contributeur. Les parts doivent totaliser 100 %, avec deux décimales maximum.
Compte YNX du contributeur
Part (%)
Retirer le contributeur
Ajouter un contributeur
Vérifiez les droits, une expiration future, le hachage de la preuve et des parts totalisant 100 %.
Historique des versions
Choisir l’expiration de l’invitation
Expiration de l’invitation
Version d’autorisation
Déclaré par
SHA-256 du fichier d’origine
Examiné par
Oui
Non''',
'de':'''Einsprüche und Streitfälle
Gib einen Grund für die Prüfung durch eine Person an. Ein Einspruch stellt die Veröffentlichung nicht wieder her und bestätigt keine Zahlung. Gespeicherte Anfragen können anhand der neuesten Einträge wiederhergestellt werden.
Keine Meldungen zu deinen zugänglichen Videos.
Einspruch einreichen
Einnahmeneintrag beanstanden
Grund (bis zu 2.000 Zeichen)
Prüfe ein PNG-, JPEG- oder WebP-Vorschaubild (bis zu 5 MiB) oder eine UTF-8-WebVTT-Untertiteldatei (bis zu 1 MiB) und bestätige den Upload ausdrücklich. Untertitel werden als von einer Person genehmigt markiert. Gespeicherte Uploads bleiben beim ursprünglichen Konto.
Vorschaubild
Untertitel
Von einer Person genehmigt
Prüfung durch eine Person erforderlich
Sprachkennung der Untertitel
Untertitelname
Datei für die Vorschau auswählen
Diese Datei hochladen
Gespeicherten Medien-Upload erneut versuchen
Medien-Upload abbrechen
Prüfe Dateiformat, Größe, Untertitelsprache und Namen. Eine geänderte Datei muss erneut in der Vorschau geprüft werden.
Der Medien-Upload ist nicht bestätigt. Prüfe die neuesten Einträge und wiederhole den gespeicherten Upload.
Medium gespeichert; ursprüngliche Serverbytes geprüft.
Ich habe diese Untertiteldatei geprüft und genehmige sie für dieses Video.
KI-Dienst prüfen
AI Gateway ist eingerichtet. Jedes Ergebnis nennt Anbieter und Modell.
Der KI-Dienst ist nicht verfügbar. Bestehende gespeicherte Aufgaben bleiben erhalten.
Der Status des KI-Dienstes ist unbestätigt. Prüfe ihn vor der Ausführungsgenehmigung.
Bereite eine Aufgabe vor, um ihren ursprünglichen Kontext, die Ausgabesprache und den geschätzten Verbrauch zu prüfen. Die Ausführung benötigt eine gesonderte Genehmigung.
Video auswählen
Aufgabe
Ausgabesprache
Metadaten als Kontext erlauben
Untertitel als Kontext erlauben
Kontextvorschau vorbereiten
Gespeicherte Aufgaben
Gespeicherte Aufgabe auswählen
Ursprüngliche gespeicherte Aufgabe öffnen
Vorschau des geteilten Kontexts
Geschätzter Verbrauch
Warte auf den ursprünglichen Aufgabenstream…
Noch kein gespeichertes Ergebnis.
Vorschläge müssen von dir geprüft werden. Die Annahme veröffentlicht kein Video und ändert keine Rechte.
Status der ursprünglichen Aufgabe prüfen
Diesen Kontext genehmigen und ausführen
KI-Aufgabe abbrechen
Vorschlag annehmen
Vorschlag ablehnen
Kontext und Ergebnis löschen
Gespeicherten Kontext und Ergebnis dieser KI-Aufgabe löschen? Videoinhalt und Rechte bleiben erhalten.
Diese ursprüngliche gespeicherte Aufgabe konnte nicht bestätigt werden. Prüfe die Verbindung und versuche es erneut.
Diese Aufgabe läuft oder muss wiederhergestellt werden. Prüfe ihren ursprünglich gespeicherten Status; starte keine Ersatzaufgabe.
Der Abbruch ist unbestätigt. Wiederhole den gespeicherten Abbruch, um die ursprüngliche Aufgabe zu prüfen.
Abbruch der ursprünglichen Aufgabe bestätigt.
Die Aufgabe ist bereits abgeschlossen. Das Ergebnis kann weiterhin geprüft werden.
Gespeicherten KI-Abbruch erneut versuchen
Zusammenfassung
Kapitel
Untertitel
Metadaten
Suchhilfe
Erläuterung der Moderation
Warte auf deine Genehmigung
Wird ausgeführt
Deine Prüfung ist erforderlich
Vorschlag angenommen
Vorschlag abgelehnt
Abgebrochen
Wiederherstellung erforderlich
Inhaber der Einnahmen
Exklusive Lizenz
Beginn der Rechte festlegen
Ende der Rechte festlegen
Beginn der Rechte
Ende der Rechte
Mitwirkende und Anteile
Trage jedes YNX-Konto nur einmal ein. Die Anteile müssen zusammen 100 % ergeben, mit höchstens zwei Nachkommastellen.
YNX-Konto des Mitwirkenden
Anteil (%)
Mitwirkenden entfernen
Mitwirkenden hinzufügen
Prüfe die Rechte, das künftige Ablaufdatum, den Nachweis-Hash und die Anteile mit insgesamt 100 %.
Versionsverlauf
Ablauf der Einladung festlegen
Einladung läuft ab
Berechtigungsversion
Erklärt von
SHA-256 der Originaldatei
Geprüft von
Ja
Nein''',
'pt':'''Recursos e disputas
Envie um motivo para análise humana. Um recurso não restaura a publicação nem confirma o pagamento. Solicitações salvas podem ser recuperadas a partir dos registros mais recentes.
Não há denúncias nos vídeos a que você tem acesso.
Enviar recurso
Contestar registro de receita
Motivo (até 2.000 caracteres)
Visualize uma miniatura PNG, JPEG ou WebP (até 5 MiB), ou um arquivo de legendas WebVTT em UTF-8 (até 1 MiB), e confirme o envio. As legendas serão marcadas como aprovadas por uma pessoa. Envios salvos permanecem na conta original.
Miniatura
Legendas
Aprovado por uma pessoa
Exige análise humana
Código de idioma das legendas
Nome das legendas
Escolher arquivo para visualizar
Enviar este arquivo
Tentar novamente o envio salvo do arquivo
Cancelar envio do arquivo
Verifique o formato, o tamanho, o idioma e o nome das legendas. Um arquivo alterado precisa ser visualizado novamente.
O envio do arquivo não está confirmado. Consulte os registros mais recentes e tente novamente o envio salvo.
Arquivo salvo; bytes originais do servidor verificados.
Revisei este arquivo de legendas e aprovo seu uso neste vídeo.
Verificar serviço de IA
AI Gateway está configurado. Cada resultado registra seu provedor e modelo.
O serviço de IA está indisponível. As tarefas salvas existentes são mantidas.
O estado do serviço de IA não está confirmado. Verifique antes de aprovar a execução.
Prepare uma tarefa para analisar o contexto original, o idioma de saída e as unidades estimadas. A execução exige uma aprovação separada.
Escolher vídeo
Tarefa
Idioma de saída
Permitir contexto de metadados
Permitir contexto de legendas
Preparar prévia do contexto
Tarefas salvas
Escolher tarefa salva
Abrir tarefa original salva
Prévia do contexto compartilhado
Unidades estimadas
Aguardando o fluxo da tarefa original…
Ainda não há resultado salvo.
As sugestões exigem sua análise. Aceitar uma sugestão não publica um vídeo nem altera seus direitos.
Verificar estado da tarefa original
Aprovar este contexto e executar
Cancelar tarefa de IA
Aceitar sugestão
Rejeitar sugestão
Excluir contexto e resultado
Excluir o contexto e o resultado salvos desta tarefa de IA? O conteúdo do vídeo e seus direitos serão mantidos.
Não foi possível confirmar esta tarefa original salva. Verifique sua conexão e tente novamente.
Esta tarefa está em execução ou exige recuperação. Verifique seu estado original salvo; não inicie uma tarefa substituta.
O cancelamento não está confirmado. Tente novamente o cancelamento salvo para verificar a tarefa original.
Cancelamento da tarefa original confirmado.
A tarefa já foi concluída. O resultado permanece disponível para análise.
Tentar novamente o cancelamento de IA salvo
Resumo
Capítulos
Legendas
Metadados
Ajuda de pesquisa
Explicação da moderação
Aguardando sua aprovação
Em execução
Exige sua análise
Sugestão aceita
Sugestão rejeitada
Cancelada
Recuperação necessária
Titular da receita
Licença exclusiva
Definir data de início dos direitos
Definir data de fim dos direitos
Início dos direitos
Fim dos direitos
Colaboradores e participações
Use a conta YNX de cada colaborador apenas uma vez. As participações devem somar 100%, com até duas casas decimais.
Conta YNX do colaborador
Participação (%)
Remover colaborador
Adicionar colaborador
Verifique os direitos, a expiração futura, o hash da prova e as participações que devem somar 100%.
Histórico de versões
Escolher expiração do convite
Expiração do convite
Versão de autorização
Declarado por
SHA-256 do arquivo original
Analisado por
Sim
Não''',
'ru':'''Апелляции и споры
Укажите причину для рассмотрения человеком. Апелляция не восстанавливает публикацию и не подтверждает оплату. Сохранённые запросы можно восстановить по последним записям.
Нет жалоб на доступные вам видео.
Подать апелляцию
Оспорить запись о доходе
Причина (до 2 000 символов)
Просмотрите миниатюру PNG, JPEG или WebP (до 5 MiB) либо файл субтитров WebVTT в UTF-8 (до 1 MiB), затем явно подтвердите загрузку. Субтитры будут отмечены как одобренные человеком. Сохранённые загрузки остаются в исходном аккаунте.
Миниатюра
Субтитры
Одобрено человеком
Требуется проверка человеком
Языковой тег субтитров
Название субтитров
Выбрать файл для просмотра
Загрузить этот файл
Повторить сохранённую загрузку материала
Отменить загрузку материала
Проверьте формат, размер, язык и название субтитров. Изменённый файл нужно просмотреть заново.
Загрузка материала не подтверждена. Проверьте последние записи и повторите сохранённую загрузку.
Материал сохранён; исходные байты сервера проверены.
Я проверил этот файл субтитров и одобряю его использование в данном видео.
Проверить сервис ИИ
AI Gateway настроен. Каждый результат содержит поставщика и модель.
Сервис ИИ недоступен. Существующие сохранённые задачи остаются.
Состояние сервиса ИИ не подтверждено. Проверьте его перед одобрением запуска.
Подготовьте задачу, чтобы проверить исходный контекст, язык результата и расчётное количество единиц. Для запуска нужно отдельное одобрение.
Выбрать видео
Задача
Язык результата
Разрешить контекст метаданных
Разрешить контекст субтитров
Подготовить просмотр контекста
Сохранённые задачи
Выбрать сохранённую задачу
Открыть исходную сохранённую задачу
Просмотр передаваемого контекста
Расчётное количество единиц
Ожидание потока исходной задачи…
Сохранённого результата пока нет.
Предложения требуют вашей проверки. Принятие предложения не публикует видео и не меняет права на него.
Проверить состояние исходной задачи
Одобрить контекст и запустить
Отменить задачу ИИ
Принять предложение
Отклонить предложение
Удалить контекст и результат
Удалить сохранённые контекст и результат этой задачи ИИ? Содержимое видео и права будут сохранены.
Не удалось подтвердить исходную сохранённую задачу. Проверьте соединение и повторите попытку.
Задача выполняется или требует восстановления. Проверьте её исходное сохранённое состояние; не создавайте заменяющую задачу.
Отмена не подтверждена. Повторите сохранённый запрос отмены для проверки исходной задачи.
Отмена исходной задачи подтверждена.
Задача уже завершена. Её результат остаётся доступным для проверки.
Повторить сохранённую отмену задачи ИИ
Сводка
Главы
Субтитры
Метаданные
Помощь в поиске
Объяснение модерации
Ожидает вашего одобрения
Выполняется
Требует вашей проверки
Предложение принято
Предложение отклонено
Отменена
Требуется восстановление
Владелец дохода
Исключительная лицензия
Установить дату начала прав
Установить дату окончания прав
Начало прав
Окончание прав
Участники и доли
Указывайте каждый аккаунт YNX один раз. Сумма долей должна быть 100%, не более двух знаков после запятой.
Аккаунт YNX участника
Доля (%)
Удалить участника
Добавить участника
Проверьте права, будущий срок окончания, хеш доказательства и доли с общей суммой 100%.
История версий
Выбрать срок действия приглашения
Приглашение истекает
Версия разрешений
Заявитель
SHA-256 исходного файла
Проверено
Да
Нет''',
'ar':'''الطعون والنزاعات
أرسل سببًا للمراجعة البشرية. الطعن لا يعيد النشر ولا يؤكد الدفع. يمكن استعادة الطلبات المحفوظة من أحدث السجلات.
لا توجد بلاغات على الفيديوهات التي يمكنك الوصول إليها.
تقديم طعن
الاعتراض على سجل الإيرادات
السبب (حتى 2,000 حرف)
عاين صورة مصغرة بصيغة PNG أو JPEG أو WebP (حتى 5 MiB)، أو ملف ترجمة WebVTT بترميز UTF-8 (حتى 1 MiB)، ثم أكد رفعه صراحةً. ستُسجل الترجمة على أنها معتمدة بشريًا. تبقى عمليات الرفع المحفوظة مرتبطة بحسابها الأصلي.
الصورة المصغرة
الترجمة
معتمد بشريًا
يلزم إجراء مراجعة بشرية
وسم لغة الترجمة
اسم الترجمة
اختيار ملف للمعاينة
رفع هذا الملف
إعادة محاولة رفع الملف المحفوظ
إلغاء رفع الملف
تحقق من صيغة الملف وحجمه ولغة الترجمة واسمها. يجب معاينة الملف مجددًا إذا تغير.
رفع الملف غير مؤكد. تحقق من أحدث السجلات ثم أعد محاولة الرفع المحفوظ.
تم حفظ الملف والتحقق من بايتات الخادم الأصلي.
راجعت ملف الترجمة هذا وأوافق على استخدامه لهذا الفيديو.
فحص خدمة الذكاء الاصطناعي
تم إعداد AI Gateway. يسجل كل ناتج المزوّد والنموذج المستخدم.
خدمة الذكاء الاصطناعي غير متاحة. ستُحفظ المهام الموجودة.
حالة خدمة الذكاء الاصطناعي غير مؤكدة. تحقق منها قبل الموافقة على التنفيذ.
جهز مهمة للاطلاع على سياقها الأصلي ولغة الناتج والوحدات المقدرة. يتطلب التنفيذ موافقة منفصلة.
اختيار فيديو
المهمة
لغة الناتج
السماح بسياق البيانات الوصفية
السماح بسياق الترجمة
تجهيز معاينة السياق
المهام المحفوظة
اختيار مهمة محفوظة
فتح المهمة الأصلية المحفوظة
معاينة السياق المشترك
الوحدات المقدرة
بانتظار تدفق المهمة الأصلية…
لا يوجد ناتج محفوظ بعد.
تحتاج الاقتراحات إلى مراجعتك. قبول الاقتراح لا ينشر الفيديو ولا يغير حقوقه.
فحص حالة المهمة الأصلية
الموافقة على هذا السياق والتنفيذ
إلغاء مهمة الذكاء الاصطناعي
قبول الاقتراح
رفض الاقتراح
حذف السياق والناتج
هل تريد حذف السياق والناتج المحفوظين لهذه المهمة؟ سيبقى محتوى الفيديو وحقوقه محفوظين.
تعذر تأكيد هذه المهمة الأصلية المحفوظة. تحقق من اتصالك وحاول مجددًا.
المهمة قيد التنفيذ أو تحتاج إلى استعادة. تحقق من حالتها الأصلية المحفوظة ولا تبدأ مهمة بديلة.
الإلغاء غير مؤكد. أعد محاولة طلب الإلغاء المحفوظ لفحص المهمة الأصلية.
تم تأكيد إلغاء المهمة الأصلية.
انتهت المهمة بالفعل. يبقى ناتجها متاحًا للمراجعة.
إعادة محاولة إلغاء مهمة الذكاء الاصطناعي المحفوظ
الملخص
الفصول
الترجمة
البيانات الوصفية
المساعدة في البحث
شرح الإشراف على المحتوى
بانتظار موافقتك
قيد التنفيذ
تحتاج إلى مراجعتك
تم قبول الاقتراح
تم رفض الاقتراح
ملغاة
تحتاج إلى استعادة
مالك الإيرادات
ترخيص حصري
تحديد تاريخ بدء الحقوق
تحديد تاريخ انتهاء الحقوق
بدء الحقوق
انتهاء الحقوق
المساهمون ونسبهم
استخدم حساب YNX لكل مساهم مرة واحدة. يجب أن يكون مجموع النسب 100%، مع منزلتين عشريتين كحد أقصى.
حساب YNX للمساهم
النسبة (%)
إزالة مساهم
إضافة مساهم
تحقق من تفاصيل الحقوق وتاريخ انتهاء مستقبلي وبصمة الإثبات ونسب المساهمين التي يجب أن يبلغ مجموعها 100%.
سجل الإصدارات
اختيار انتهاء صلاحية الدعوة
انتهاء صلاحية الدعوة
إصدار التفويض
صاحب الإقرار
SHA-256 للملف الأصلي
تمت المراجعة بواسطة
نعم
لا''',
'id':'''Banding dan sengketa
Kirim alasan untuk ditinjau manusia. Banding tidak memulihkan publikasi atau mengonfirmasi pembayaran. Permintaan tersimpan dapat dipulihkan dari catatan terbaru.
Tidak ada laporan pada video yang dapat Anda akses.
Ajukan banding
Sengketakan catatan pendapatan
Alasan (maksimal 2.000 karakter)
Pratinjau gambar mini PNG, JPEG, atau WebP (maksimal 5 MiB), atau berkas subtitel WebVTT UTF-8 (maksimal 1 MiB), lalu setujui unggahannya secara eksplisit. Subtitel akan ditandai disetujui manusia. Unggahan tersimpan tetap berada pada akun asalnya.
Gambar mini
Subtitel
Disetujui manusia
Perlu tinjauan manusia
Tag bahasa subtitel
Nama subtitel
Pilih berkas untuk pratinjau
Unggah berkas ini
Coba lagi unggahan berkas tersimpan
Batalkan unggahan berkas
Periksa format, ukuran, bahasa dan nama subtitel. Berkas yang berubah harus dipratinjau kembali.
Unggahan berkas belum terkonfirmasi. Periksa catatan terbaru, lalu coba lagi unggahan tersimpan.
Berkas tersimpan; byte server asal telah diverifikasi.
Saya telah meninjau berkas subtitel ini dan menyetujui penggunaannya pada video ini.
Periksa layanan AI
AI Gateway telah dikonfigurasi. Setiap hasil mencatat penyedia dan modelnya.
Layanan AI tidak tersedia. Tugas tersimpan yang ada tetap dipertahankan.
Status layanan AI belum terkonfirmasi. Periksa sebelum menyetujui eksekusi.
Siapkan tugas untuk melihat konteks aslinya, bahasa keluaran dan perkiraan unit. Eksekusi memerlukan persetujuan terpisah.
Pilih video
Tugas
Bahasa keluaran
Izinkan konteks metadata
Izinkan konteks subtitel
Siapkan pratinjau konteks
Tugas tersimpan
Pilih tugas tersimpan
Buka tugas asli tersimpan
Pratinjau konteks yang dibagikan
Perkiraan unit
Menunggu aliran tugas asli…
Belum ada hasil tersimpan.
Saran perlu Anda tinjau. Menerima saran tidak memublikasikan video atau mengubah haknya.
Periksa status tugas asli
Setujui konteks ini dan jalankan
Batalkan tugas AI
Terima saran
Tolak saran
Hapus konteks dan hasil
Hapus konteks dan hasil tersimpan dari tugas AI ini? Konten video dan haknya tetap dipertahankan.
Tugas asli tersimpan ini tidak dapat dikonfirmasi. Periksa koneksi Anda dan coba lagi.
Tugas ini berjalan atau memerlukan pemulihan. Periksa status asli yang tersimpan; jangan mulai tugas pengganti.
Pembatalan belum terkonfirmasi. Coba lagi pembatalan tersimpan untuk memeriksa tugas asli.
Pembatalan tugas asli terkonfirmasi.
Tugas sudah selesai. Hasilnya tetap tersedia untuk ditinjau.
Coba lagi pembatalan AI tersimpan
Ringkasan
Bab
Subtitel
Metadata
Bantuan pencarian
Penjelasan moderasi
Menunggu persetujuan Anda
Berjalan
Perlu tinjauan Anda
Saran diterima
Saran ditolak
Dibatalkan
Perlu pemulihan
Pemilik pendapatan
Lisensi eksklusif
Tetapkan tanggal mulai hak
Tetapkan tanggal berakhir hak
Mulai hak
Akhir hak
Kontributor dan bagiannya
Gunakan akun YNX setiap kontributor hanya sekali. Jumlah bagian harus 100%, dengan maksimal dua angka desimal.
Akun YNX kontributor
Bagian (%)
Hapus kontributor
Tambah kontributor
Periksa detail hak, tanggal kedaluwarsa mendatang, hash bukti dan bagian kontributor yang harus berjumlah 100%.
Riwayat versi
Pilih masa berlaku undangan
Undangan berakhir
Versi otorisasi
Dinyatakan oleh
SHA-256 berkas asli
Ditinjau oleh
Ya
Tidak'''
}
assert len(keys)==88
for lang,block in translations.items():
 values=block.splitlines();assert len(values)==len(keys),(lang,len(values),len(keys));assert all(values)
 assert set(keys)==set(j['en'])-set(j[lang]),lang
 j[lang].update(zip(keys,values))
assert all(set(v)==set(j['en']) for v in j.values())
p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'translatedLocales':list(translations),'newTexts':len(keys)*len(translations),'keysPerLocale':len(j['en']),'everyLocaleKeyComplete':True}))
