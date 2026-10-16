/**
 * i18n-sw.js - Kiswahili phrases for i18n.js. Left = the exact English text on the screen, right = Kiswahili.
 * Matching ignores case and extra spaces. Missing phrases stay in English: in Kiswahili mode run I18n.missing()
 * in the browser console to list what is still untranslated, then add it here.
 * Coverage: navigation, common buttons/labels/statuses, sales & cash, products & stock, billing, country & language,
 * sign-in / register. Wholesale, CRM, SMS, repairs and the walkthrough tour are mostly still English.
 */
window.I18N_SW = {
  /* ---- navigation ---- */
  'Dashboard': 'Dashibodi', 'Setup guide': 'Mwongozo wa kuanza', 'Sales': 'Mauzo', 'Products': 'Bidhaa', 'Inventory': 'Hesabu ya bidhaa',
  'Wholesale inventory': 'Bidhaa za jumla', 'Batches & expiry': 'Bechi na tarehe za kuisha', 'Stocktake': 'Kuhesabu bidhaa', 'Serial numbers': 'Namba za mfululizo',
  'Warranty claims': 'Madai ya dhamana', 'Repairs': 'Matengenezo', 'Vehicles': 'Magari', 'Job cards': 'Kadi za kazi', 'Suppliers': 'Wasambazaji',
  'Purchases': 'Manunuzi', 'Expenses': 'Matumizi', 'Refunds': 'Marejesho', 'Reports': 'Ripoti', 'Audit log': 'Kumbukumbu za ukaguzi',
  'Registers & Shifts': 'Rejista na zamu', 'Offline review': 'Mapitio ya nje ya mtandao', 'Branches': 'Matawi', 'Employees': 'Wafanyakazi',
  'Customers': 'Wateja', 'CRM': 'Usimamizi wa wateja', 'SMS': 'SMS', 'Tickets': 'Tiketi', 'Notifications': 'Arifa', 'Billing': 'Malipo ya usajili',
  'Settings': 'Mipangilio', 'Wholesale': 'Jumla', 'Warehouses': 'Maghala', 'Warehouses & stock': 'Maghala na bidhaa', 'Payables': 'Madeni ya wasambazaji',
  'Menu': 'Menyu', 'Open menu': 'Fungua menyu', 'Log out': 'Toka', 'Collapse': 'Kunja', 'Help & Support': 'Msaada',

  /* ---- common buttons ---- */
  'Cancel': 'Ghairi', 'Close': 'Funga', 'Save': 'Hifadhi', 'Save changes': 'Hifadhi mabadiliko', 'Edit': 'Hariri', 'Delete': 'Futa', 'Remove': 'Ondoa',
  'Add': 'Ongeza', 'Apply': 'Tumia', 'Back': 'Rudi', 'Next': 'Endelea', 'Done': 'Imekamilika', 'Confirm': 'Thibitisha', 'Continue': 'Endelea',
  'Refresh': 'Onyesha upya', 'Try again': 'Jaribu tena', 'Retry': 'Jaribu tena', 'View': 'Tazama', 'View all': 'Tazama zote', 'Open': 'Fungua',
  'Search': 'Tafuta', 'Clear': 'Futa', 'Clear filters': 'Futa vichujio', 'Filter': 'Chuja', 'Export CSV': 'Pakua CSV', 'Download': 'Pakua',
  'Print': 'Chapisha', 'Share': 'Shiriki', 'Copy': 'Nakili', 'Copied': 'Imenakiliwa', 'Pay': 'Lipa', 'Pay now': 'Lipa sasa', 'Approve': 'Idhinisha',
  'Reject': 'Kataa', 'Accept': 'Kubali', 'Discard': 'Tupa', 'Void': 'Batilisha', 'Archive': 'Hifadhi kwenye kumbukumbu', 'Load more': 'Pakia zaidi',
  'Submit': 'Wasilisha', 'Update': 'Sasisha', 'Create': 'Unda', 'New': 'Mpya', 'Later': 'Baadaye', 'Not now': 'Si sasa', 'Dismiss': 'Ondoa',
  'Mark all read': 'Weka zote kuwa zimesomwa', 'Select all': 'Chagua zote', 'Change': 'Badilisha', 'Unlock': 'Fungua', 'Lock': 'Funga',
  'Record payment': 'Rekodi malipo', 'Complete sale': 'Kamilisha mauzo', 'New sale': 'Mauzo mapya', 'Add product': 'Ongeza bidhaa', 'Sync now': 'Sawazisha sasa',
  'Send': 'Tuma', 'Reset': 'Weka upya', 'Manage': 'Simamia', 'Details': 'Maelezo', 'Receipt': 'Risiti', 'Invoice': 'Ankara', 'Invoices': 'Ankara',

  /* ---- common labels ---- */
  'Status': 'Hali', 'Total': 'Jumla', 'Subtotal': 'Jumla ndogo', 'Product': 'Bidhaa', 'Amount': 'Kiasi', 'Branch': 'Tawi', 'Phone': 'Simu', 'Date': 'Tarehe',
  'Customer': 'Mteja', 'Warehouse': 'Ghala', 'Address': 'Anwani', 'Name': 'Jina', 'Balance': 'Salio', 'Loading…': 'Inapakia…', 'Loading...': 'Inapakia…',
  'Email': 'Barua pepe', 'Method': 'Njia', 'Reference': 'Rejea', 'Notes': 'Maelezo', 'Note': 'Maelezo', 'Items': 'Bidhaa', 'Item': 'Bidhaa', 'Qty': 'Idadi',
  'Quantity': 'Idadi', 'Barcode': 'Msimbo pau', 'Cashier': 'Mhudumu wa kaunta', 'Reason': 'Sababu', 'Supplier': 'Msambazaji', 'Paid': 'Imelipwa', 'Unpaid': 'Haijalipwa',
  'Part paid': 'Imelipwa sehemu', 'All': 'Zote', 'Code': 'Msimbo', 'Inactive': 'Haitumiki', 'Active': 'Inatumika', 'Type': 'Aina', 'Unit': 'Kipimo',
  'Due': 'Inadaiwa', 'When': 'Lini', 'Description': 'Maelezo', 'Price': 'Bei', 'Category': 'Kundi', 'Cost': 'Gharama', 'Profit': 'Faida', 'Tax': 'Kodi',
  'Discount': 'Punguzo', 'Cash': 'Pesa taslimu', 'Card': 'Kadi', 'Bank': 'Benki', 'Other': 'Nyingine', 'None': 'Hakuna', 'Default': 'Chaguo-msingi', 'Time': 'Muda',
  'Role': 'Cheo', 'Password': 'Nenosiri', 'PIN': 'PIN', 'Message': 'Ujumbe', 'Payment': 'Malipo', 'Payments': 'Malipo', 'Payment terms': 'Masharti ya malipo',
  'Stock': 'Akiba ya bidhaa', 'Low stock': 'Bidhaa zinaisha', 'Out of stock': 'Imeisha', 'Low': 'Chini', 'OK': 'Sawa', 'Walk-in': 'Mteja wa kawaida',
  'All branches': 'Matawi yote', 'This branch': 'Tawi hili', 'All categories': 'Makundi yote', 'All statuses': 'Hali zote', 'All customers': 'Wateja wote',
  'Select a branch first': 'Chagua tawi kwanza', 'Choose…': 'Chagua…', 'Offline': 'Nje ya mtandao', 'Online': 'Mtandaoni', 'Overdue': 'Imechelewa',
  'Cancelled': 'Imefutwa', 'Closed': 'Imefungwa', 'Approved': 'Imeidhinishwa', 'Rejected': 'Imekataliwa', 'Pending': 'Inasubiri', 'Saved': 'Imehifadhiwa',
  'Updated': 'Imesasishwa', 'Enabled': 'Imewashwa', 'Contact': 'Mawasiliano', 'Town': 'Mji', 'County': 'Kaunti', 'Opening float': 'Pesa ya kuanzia',
  'Expected cash': 'Pesa inayotarajiwa', 'Difference': 'Tofauti', 'Shortage': 'Pungufu', 'Counted': 'Iliyohesabiwa', 'Total counted': 'Jumla iliyohesabiwa',
  'Cash counted by denomination': 'Pesa iliyohesabiwa kwa thamani', 'Note / coin': 'Noti / sarafu', 'Count': 'Idadi', 'Count the cash': 'Hesabu pesa',
  'Change to give back': 'Chenji ya kumrudishia', 'Cart is empty': 'Kikapu kiko tupu', 'No items added yet.': 'Hakuna bidhaa zilizoongezwa bado.',
  'Search by name or phone': 'Tafuta kwa jina au simu', 'Search by name, SKU, or barcode': 'Tafuta kwa jina, SKU au msimbo pau', 'Search product…': 'Tafuta bidhaa…',
  'Walk-in customer': 'Mteja wa kawaida', 'Cart discount': 'Punguzo la kikapu', 'Amount received from customer': 'Kiasi alichopokea kutoka kwa mteja',
  'Open shift': 'Fungua zamu', 'Close shift': 'Funga zamu', 'Shifts': 'Zamu', 'Registers': 'Rejista', 'Cash received': 'Pesa iliyopokelewa', 'Tendered': 'Alichotoa',
  'Selling price': 'Bei ya kuuza', 'Cost price': 'Bei ya ununuzi', 'Product name': 'Jina la bidhaa', 'Opening stock': 'Akiba ya kuanzia', 'Expiry date': 'Tarehe ya kuisha',
  'Credit limit': 'Kikomo cha mkopo', 'Outstanding': 'Inayodaiwa', 'Owes': 'Anadaiwa', 'Statements': 'Taarifa', 'Statement': 'Taarifa', 'Ledger': 'Leja',

  /* ---- messages / toasts ---- */
  'Customer added': 'Mteja ameongezwa', 'Payment recorded': 'Malipo yamerekodiwa', 'Settings saved': 'Mipangilio imehifadhiwa', 'Stock adjusted': 'Akiba imerekebishwa',
  'Select a product first': 'Chagua bidhaa kwanza', 'Enter an amount': 'Weka kiasi', 'Enter a quantity above zero': 'Weka idadi kubwa kuliko sifuri',
  'Add at least one item': 'Ongeza angalau bidhaa moja', 'Choose a customer for a wholesale sale': 'Chagua mteja kwa mauzo ya jumla',
  'Close the cash drawer before logging out.': 'Funga droo ya pesa kabla ya kutoka.', 'Session expired, please log in again': 'Kipindi kimeisha, tafadhali ingia tena',
  'You are offline': 'Huna mtandao', "You're offline": 'Huna mtandao', 'Nothing here': 'Hakuna kitu hapa', 'No data': 'Hakuna data', 'No products yet': 'Hakuna bidhaa bado',
  'Could not load billing': 'Imeshindwa kupakia malipo ya usajili', 'Copied to clipboard': 'Imenakiliwa',
  'Could not reach the server. Check your connection.': 'Imeshindwa kufikia seva. Angalia muunganisho wako.',
  "You're offline. Reconnect to the internet and try again.": 'Huna mtandao. Unganisha intaneti kisha ujaribu tena.',

  /* ---- sign in / register ---- */
  'Welcome back': 'Karibu tena', 'Sign in to manage your shop': 'Ingia kusimamia duka lako', 'Log in': 'Ingia', 'Sign in': 'Ingia', 'Email / phone': 'Barua pepe / simu',
  'Email or phone number': 'Barua pepe au namba ya simu', 'Employee PIN': 'PIN ya mfanyakazi', 'Create one': 'Fungua akaunti', 'Set up your shop': 'Weka duka lako',
  'Create your business': 'Fungua biashara yako', 'Creates your business, a main branch, and your owner account': 'Hufungua biashara yako, tawi kuu na akaunti ya mmiliki',
  'Business name': 'Jina la biashara', 'Your full name': 'Jina lako kamili', 'Phone number': 'Namba ya simu', 'Confirm password': 'Thibitisha nenosiri',
  'Create business account': 'Fungua akaunti ya biashara', 'Country': 'Nchi', 'Language': 'Lugha', 'Sets your currency, tax labels and receipts': 'Huamua sarafu, lebo za kodi na risiti',
  'Used to log in and for M-PESA': 'Hutumika kuingia na kwa M-PESA', 'Used to log in. Tanzanian numbers only (+255)': 'Hutumika kuingia. Namba za Tanzania pekee (+255)',
  '(optional)': '(si lazima)', 'At least 8 characters': 'Angalau herufi 8', 'Passwords do not match': 'Manenosiri hayalingani',
  'Creating your business…': 'Inafungua biashara yako…', 'Please confirm you agree to be responsible for this account.': 'Tafadhali thibitisha kuwa unawajibika kwa akaunti hii.',
  'Kenya (KES)': 'Kenya (KES)',

  /* ---- country picker + language ---- */
  'Choose your country': 'Chagua nchi yako', 'Language / Lugha': 'Language / Lugha',

  /* ---- billing (owner) ---- */
  'Billing & subscription': 'Malipo ya usajili', 'Your plan, what is due, and your payment history.': 'Mpango wako, kinachodaiwa na historia ya malipo yako.',
  'Your plan': 'Mpango wako', 'Plan': 'Mpango', 'Current phase': 'Hatua ya sasa', 'Phase started': 'Hatua ilianza', 'Phase ends': 'Hatua inaisha', 'Ongoing': 'Inaendelea',
  'Plan complete': 'Mpango umekamilika', 'Coming up': 'Inayofuata', 'Nothing is scheduled.': 'Hakuna kilichopangwa.', 'Next invoice': 'Ankara ijayo',
  'Estimated amount': 'Kiasi kinachokadiriwa', 'Free trial': 'Kipindi cha majaribio', 'Payment overdue': 'Malipo yamechelewa', 'Locked': 'Imefungwa',
  'Account credit': 'Salio la akaunti', 'Open balance': 'Salio linalodaiwa', 'Total paid': 'Jumla iliyolipwa', 'Nothing overdue': 'Hakuna kilichochelewa',
  'Pay to avoid a lock': 'Lipa kuepuka kufungiwa', 'All unpaid invoices': 'Ankara zote ambazo hazijalipwa', 'Applied to your next invoice': 'Itatumika kwenye ankara yako ijayo',
  'No payments yet': 'Hakuna malipo bado', 'Outstanding invoices': 'Ankara zinazodaiwa', 'Make a payment': 'Fanya malipo', 'History': 'Historia',
  'Waiting for confirmation': 'Inasubiri uthibitisho', 'Awaiting verification': 'Inasubiri uhakiki', 'Received': 'Imepokelewa', 'Not approved': 'Haikuidhinishwa',
  'Failed': 'Imeshindwa', 'Waiting': 'Inasubiri', 'Part-paid': 'Imelipwa sehemu', 'Mobile money': 'Pesa ya simu', 'Bank transfer': 'Uhamisho wa benki',
  'Pay by mobile money / bank': 'Lipa kwa pesa ya simu / benki', 'Pay manually & paste the M-PESA message': 'Lipa mwenyewe kisha bandika ujumbe wa M-PESA',
  'M-PESA prompt (STK)': 'Ombi la M-PESA (STK)', 'M-PESA phone number': 'Namba ya simu ya M-PESA', 'Send payment prompt': 'Tuma ombi la malipo',
  'Submit for verification': 'Wasilisha kwa uhakiki', 'Paid with': 'Umelipa kwa', 'Transaction code': 'Namba ya muamala', 'Reference to use': 'Rejea ya kutumia',
  'Account / reference': 'Akaunti / rejea', 'Paste the full M-PESA confirmation message': 'Bandika ujumbe kamili wa uthibitisho wa M-PESA',
  'Confirmation message': 'Ujumbe wa uthibitisho', 'Pay to': 'Lipa kwa', 'Send the amount to the number below using your mobile money or bank app.': 'Tuma kiasi kwenda namba iliyo hapa chini kwa kutumia pesa ya simu au programu ya benki.',
  'Keep the confirmation message you receive.': 'Hifadhi ujumbe wa uthibitisho utakaopokea.',
  'Enter the transaction code and/or paste the message here, then submit.': 'Weka namba ya muamala na/au bandika ujumbe hapa, kisha wasilisha.',
  'Enter the transaction code or paste the confirmation message': 'Weka namba ya muamala au bandika ujumbe wa uthibitisho', 'Enter the amount you paid': 'Weka kiasi ulicholipa',
  'Submitted - we will verify it shortly': 'Imewasilishwa - tutahakiki hivi karibuni', 'Payment received - thank you': 'Malipo yamepokelewa - asante',
  'Payment details are not available yet': 'Maelezo ya malipo bado hayapatikani', 'Online payment is not available right now': 'Malipo ya mtandaoni hayapatikani sasa',
  'Billing is not active yet.': 'Malipo ya usajili bado hayajaanza.', 'You are not being charged and nothing is due.': 'Hutozwi chochote na hakuna kinachodaiwa.',
  'Your account is locked.': 'Akaunti yako imefungwa.', 'Billing is managed by the business owner': 'Malipo ya usajili husimamiwa na mmiliki wa biashara',
  'This account is locked': 'Akaunti hii imefungwa', 'Locked since': 'Imefungwa tangu', 'Monthly maintenance pricing': 'Bei ya matengenezo ya kila mwezi',
  'There is no automatic prompt in Tanzania. We check your payment against our statement and credit your account once verified - usually within a few hours.': 'Tanzania hakuna ombi la kiotomatiki. Tunalinganisha malipo yako na taarifa yetu na kuweka salio kwenye akaunti yako baada ya kuhakikiwa - kwa kawaida ndani ya masaa machache.',
  'We check this against our M-PESA statement and credit your account once verified - usually within a few hours.': 'Tunalinganisha na taarifa yetu ya M-PESA na kuweka salio baada ya kuhakikiwa - kwa kawaida ndani ya masaa machache.',
  'You can view billing but not pay. Ask the business owner to make payments.': 'Unaweza kuona malipo lakini huwezi kulipa. Mwombe mmiliki wa biashara afanye malipo.',
  'Your account is locked because of an unpaid balance. Pay now to restore access.': 'Akaunti yako imefungwa kwa sababu ya deni ambalo halijalipwa. Lipa sasa kurejesha huduma.',
  'View billing': 'Tazama malipo',

  /* ---- cash / shifts / money ---- */
  'Opening cash float': 'Pesa ya kuanzia droo', 'Actual cash counted': 'Pesa halisi iliyohesabiwa', 'Cash drawer settings': 'Mipangilio ya droo ya pesa', 'Drawer is closed': 'Droo imefungwa',
  'Till locked': 'Kaunta imefungwa', 'Sales history': 'Historia ya mauzo', 'Sale type': 'Aina ya mauzo', 'Retail': 'Rejareja', 'Total payable': 'Jumla ya kulipa',
  'Preparing invoice…': 'Inaandaa ankara…', 'Credit due date': 'Tarehe ya kulipa mkopo', 'Collected': 'Iliyokusanywa', 'Cash counted': 'Pesa iliyohesabiwa',

  /* ---- products / stock ---- */
  'Add stock': 'Ongeza akiba', 'Opening stock (add)': 'Akiba ya kuanzia (ongeza)', 'Damaged (remove)': 'Imeharibika (ondoa)', 'Expired (remove)': 'Imeisha muda (ondoa)', 'Lost (remove)': 'Imepotea (ondoa)',
  'Stock levels': 'Viwango vya akiba', 'Save adjustment': 'Hifadhi marekebisho', 'Adjust': 'Rekebisha', 'Movements': 'Mienendo', 'Running low': 'Inaisha',
  'Nothing running low.': 'Hakuna kinachoisha.', 'Retail value': 'Thamani ya rejareja', 'Margin': 'Faida ya ziada', 'Units': 'Vizio', 'Base units': 'Vizio vya msingi',

  /* ---- notifications / misc ---- */
  "You're all caught up.": 'Umeshasoma zote.', 'View all notifications': 'Tazama arifa zote', 'All notifications marked as read': 'Arifa zote zimewekwa kuwa zimesomwa',
  'Raise a ticket': 'Fungua tiketi', 'Short title': 'Kichwa kifupi', 'How urgent?': 'Ni ya haraka kiasi gani?', 'What is it about?': 'Inahusu nini?',
  'Got it': 'Nimeelewa', 'Update ready': 'Sasisho tayari',
};

/* Phrases with a number or name inside. [pattern on the English text, replacement]. */
window.I18N_SW_RULES = [
  [/^Free trial - (\d+) days? left\.?$/, 'Kipindi cha majaribio - siku $1 zimebaki.'],
  [/^Free trial: (\d+) days? left\.?$/, 'Kipindi cha majaribio: siku $1 zimebaki.'],
  [/^Welcome, (.+?)! Your shop is ready\.$/, 'Karibu, $1! Duka lako liko tayari.'],
  [/^Karibu, (.+)$/, 'Karibu, $1'],
  [/^(.+) is overdue\. Your account will be locked on (.+) if unpaid\.$/, '$1 imechelewa. Akaunti yako itafungwa tarehe $2 isipolipwa.'],
  [/^(.+) is overdue\.$/, '$1 imechelewa.'],
  [/^(\d+) notes? & coins$/, 'noti na sarafu $1'],
  [/^Your trial ends on (.+)\. Your first invoice is issued then\.$/, 'Kipindi chako cha majaribio kinaisha tarehe $1. Ankara yako ya kwanza hutolewa wakati huo.'],
  [/^Your account will be locked on (.+) if it stays unpaid\. Part-payments are accepted\.$/, 'Akaunti yako itafungwa tarehe $1 ikibaki bila kulipwa. Malipo ya sehemu yanakubaliwa.'],
  [/^Amount \((KES|TZS)\)$/, 'Kiasi ($1)'],
  [/^Amount paid \((KES|TZS)\)(.*)$/, 'Kiasi ulicholipa ($1)$2'],
  [/^Selling price \((KES|TZS)\)$/, 'Bei ya kuuza ($1)'],
  [/^Cost price \((KES|TZS)\)$/, 'Bei ya ununuzi ($1)'],
  [/^Cart discount \((KES|TZS)\)$/, 'Punguzo la kikapu ($1)'],
  [/^Opening cash float \((KES|TZS)\)$/, 'Pesa ya kuanzia droo ($1)'],
  [/^Ticket (\S+) raised - we'll get back to you$/, 'Tiketi $1 imefunguliwa - tutakujibu'],
  [/^Page (\d+) of (\d+)$/, 'Ukurasa $1 kati ya $2'],
  [/^(\d+) items?$/, 'Bidhaa $1'],
  [/^Overdue · (.+)$/, 'Imechelewa · $1'],
  [/^Full balance · (.+)$/, 'Salio lote · $1'],
];
