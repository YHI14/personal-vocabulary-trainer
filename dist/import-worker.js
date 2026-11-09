importScripts('./vendor/xlsx.full.min.js');
onmessage=async e=>{try{const {buffer,encoding='utf-8',delimiter}=e.data;const book=XLSX.read(buffer,{type:'array',cellDates:true,raw:true});const sheets=book.SheetNames.map(name=>({name,rows:XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,defval:'',blankrows:false,raw:false})}));postMessage({sheets});}catch(e){postMessage({error:e.message});}};
