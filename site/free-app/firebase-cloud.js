import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, linkWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { initializeFirestore, memoryLocalCache, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig, firebaseConfigured } from "./firebase-config.js";

const dispatch=(name,detail={})=>window.dispatchEvent(new CustomEvent(name,{detail}));
const legacyLocalKey="budget_reset_solo";
function userLocalKey(uid){return "budget_reset_solo_"+uid}

let auth=null,db=null,unsubscribe=null,currentUser=null,readyResolve=null;
const ready=new Promise(resolve=>{readyResolve=resolve});

function readLocal(uid=currentUser?.uid){try{const key=uid?userLocalKey(uid):legacyLocalKey;return JSON.parse(localStorage.getItem(key)||"{}")}catch{return {}}}
function hasUsefulData(data=readLocal()){
  return Number(data.income||0)>0||Number(data.budget||0)>0||
    (Array.isArray(data.expenses)&&data.expenses.length>0)||
    (Array.isArray(data.goals)&&data.goals.length>0)||
    (Array.isArray(data.installments)&&data.installments.length>0)||
    (Array.isArray(data.recurringExpenses)&&data.recurringExpenses.length>0);
}
function localTimestamp(data=readLocal()){return Number(data?._sync?.updatedAt||0)}
function normalize(data){const copy=JSON.parse(JSON.stringify(data||{}));delete copy._sync;return copy}
function sameData(a,b){try{return JSON.stringify(normalize(a))===JSON.stringify(normalize(b))}catch{return false}}

async function pushToCloud(data,source="save"){
  if(!db||!currentUser)throw new Error("Account Firebase non pronto o non autenticato.");
  const now=Math.max(Date.now(),localTimestamp(data)+1);
  data._sync={updatedAt:now};
  localStorage.setItem(userLocalKey(currentUser.uid),JSON.stringify(data));
  await setDoc(doc(db,"users",currentUser.uid),{
    budgetData:data,
    clientUpdatedAt:now,
    updatedAt:serverTimestamp(),
    email:currentUser.email||null
  },{merge:true});
  dispatch("brcloud:sync",{direction:"upload",source,data});
  return data;
}

async function applyCloudData(cloudData,cloudUpdatedAt){
  const local=readLocal(currentUser.uid);
  if(!cloudData)return {action:"none"};
  const cloudTs=Number(cloudUpdatedAt||cloudData?._sync?.updatedAt||0);
  const localTs=localTimestamp(local);
  if(!hasUsefulData(local)&&hasUsefulData(cloudData)){
    localStorage.setItem(userLocalKey(currentUser.uid),JSON.stringify({...cloudData,_sync:{updatedAt:cloudTs||Date.now()}}));
    dispatch("brcloud:loaded",{data:cloudData,source:"cloud"});
    return {action:"download"};
  }
  if(cloudTs>localTs&&cloudTs>0&&!sameData(local,cloudData)){
    localStorage.setItem(userLocalKey(currentUser.uid),JSON.stringify({...cloudData,_sync:{updatedAt:cloudTs}}));
    dispatch("brcloud:loaded",{data:cloudData,source:"cloud"});
    return {action:"download"};
  }
  if(localTs>cloudTs||(!cloudTs&&hasUsefulData(local)&&!hasUsefulData(cloudData))){
    const pushed=await pushToCloud(local,"startup-local");
    return {action:"upload",data:pushed};
  }
  if(sameData(local,cloudData)){
    dispatch("brcloud:sync",{direction:"download",source:"cloud",data:cloudData});
    return {action:"same"};
  }
  return {action:"conflict",local,cloud:cloudData};
}

async function diagnose(){
  await ready;
  if(!firebaseConfigured)throw new Error("Firebase non è configurato.");
  if(!db)throw new Error("Firestore non è stato inizializzato.");
  if(!currentUser)throw new Error("Account non autenticato.");
  const ref=doc(db,"users",currentUser.uid);
  try{
    const snap=await getDoc(ref);
    return {ok:true,authenticated:true,firestoreReadable:true,exists:snap.exists(),uid:currentUser.uid,email:currentUser.email||""};
  }catch(error){
    const code=error?.code||"unknown";
    let hint=error?.message||"Errore Firestore";
    if(code==="permission-denied")hint="PERMISSION_DENIED: le Firestore Rules stanno rifiutando l'accesso dell'utente.";
    else if(code==="failed-precondition")hint="FAILED_PRECONDITION: Firestore potrebbe non essere stato creato/abilitato correttamente.";
    else if(code==="unavailable")hint="UNAVAILABLE: Firestore non è raggiungibile dalla rete.";
    throw new Error(hint);
  }
}
async function syncNow(){
  await ready;
  if(!db||!currentUser)throw new Error("Accedi a Budget Reset prima di sincronizzare.");
  const ref=doc(db,"users",currentUser.uid);
  const snap=await getDoc(ref);
  const local=readLocal(currentUser.uid);
  if(!snap.exists()){
    if(hasUsefulData(local)){await pushToCloud(local,"manual-upload");return "upload"}
    throw new Error("Il tuo account non contiene ancora dati nel cloud.");
  }
  const cloudData=snap.data()?.budgetData||null;
  const cloudTs=Number(snap.data()?.clientUpdatedAt||cloudData?._sync?.updatedAt||0);
  if(cloudData&&hasUsefulData(cloudData)&&!hasUsefulData(local)){
    await applyCloudData(cloudData,cloudTs);return "download";
  }
  if(!cloudData||!hasUsefulData(cloudData)){
    await pushToCloud(local,"manual-upload");return "upload";
  }
  const localTs=localTimestamp(local);
  if(localTs>=cloudTs){await pushToCloud(local,"manual-upload");return "upload"}
  await applyCloudData(cloudData,cloudTs);return "download";
}

async function startCloud(){
  if(!firebaseConfigured){dispatch("brcloud:status",{configured:false,user:null,message:"Firebase non configurato"});readyResolve();return;}
  try{
    const app=initializeApp(firebaseConfig);
    auth=getAuth(app);
    try{db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})})}
    catch{db=initializeFirestore(app,{localCache:memoryLocalCache()})}
    onAuthStateChanged(auth,async user=>{
      currentUser=user||null;
      dispatch("brcloud:status",{configured:true,user:user?{uid:user.uid,email:user.email}:null,message:user?"Cloud attivo":"Non autenticato"});
      if(unsubscribe){unsubscribe();unsubscribe=null}
      if(!user){readyResolve();return;}
      try{
        const ref=doc(db,"users",user.uid),snap=await getDoc(ref),local=readLocal(user.uid);
        if(!snap.exists()){
          // A brand-new account must start empty. Never copy the legacy browser cache here.
          const empty={income:0,budget:0,expenses:[],goals:[],splits:[],emergency:{},installments:[],recurringExpenses:[],incomes:[],budgets:[],scheduled:[],categories:[]};
          await setDoc(ref,{budgetData:empty,clientUpdatedAt:Date.now(),updatedAt:serverTimestamp(),email:user.email||null},{merge:true});
          localStorage.setItem(userLocalKey(user.uid),JSON.stringify(empty));
          dispatch("brcloud:session-data",{uid:user.uid,data:empty,source:"new-account"});
        }else{
          const cloudData=snap.data()?.budgetData||null,cloudTs=Number(snap.data()?.clientUpdatedAt||cloudData?._sync?.updatedAt||0);
          if(cloudData){
            await applyCloudData(cloudData,cloudTs);
            const loaded=readLocal(user.uid);
            dispatch("brcloud:session-data",{uid:user.uid,data:loaded,source:"cloud"});
          }else{
            const empty=local;
            await pushToCloud(empty,"repair-empty-cloud");
            dispatch("brcloud:session-data",{uid:user.uid,data:empty,source:"repair"});
          }
        }
        unsubscribe=onSnapshot(ref,snapshot=>{
          if(!snapshot.exists()||snapshot.metadata.hasPendingWrites)return;
          const cloudData=snapshot.data()?.budgetData;if(!cloudData)return;
          const cloudTs=Number(snapshot.data()?.clientUpdatedAt||cloudData?._sync?.updatedAt||0);
          const localNow=readLocal(currentUser.uid);
          if(cloudTs>localTimestamp(localNow)&&!sameData(localNow,cloudData)){
            dispatch("brcloud:session-data",{uid:currentUser.uid,data:cloudData,source:"realtime"});
          }
        });
      }catch(error){dispatch("brcloud:error",{message:error?.message||"Errore nella sincronizzazione Firebase"})}
      finally{readyResolve()}
    });
  }catch(error){dispatch("brcloud:error",{message:error?.message||"Impossibile inizializzare Firebase"});readyResolve()}
}

async function save(data){
  localStorage.setItem(userLocalKey(currentUser.uid),JSON.stringify(data));
  await ready;
  if(!db||!currentUser)return {cloud:false};
  try{return {cloud:true,data:await pushToCloud(data,"save")}}
  catch(error){
    const code=error?.code||"unknown";
    let message=error?.message||"Errore Firestore";
    if(code==="permission-denied")message="PERMISSION_DENIED: verifica le Firestore Rules.";
    else if(code==="failed-precondition")message="FAILED_PRECONDITION: verifica che Firestore Database sia stato creato e sia attivo.";
    else if(code==="unavailable")message="UNAVAILABLE: Firestore non è raggiungibile.";
    throw new Error(message);
  }
}
let pendingGoogleCredential=null;
const pendingGoogleKey="br_google_pending_credential";
function storePendingGoogleCredential(credential){
  pendingGoogleCredential=credential||null;
  try{
    if(credential){
      sessionStorage.setItem(pendingGoogleKey,JSON.stringify({idToken:credential.idToken||null,accessToken:credential.accessToken||null}));
    }else sessionStorage.removeItem(pendingGoogleKey);
  }catch{}
}
function restorePendingGoogleCredential(){
  try{
    const raw=sessionStorage.getItem(pendingGoogleKey);if(!raw)return null;
    const x=JSON.parse(raw);
    if(x?.idToken||x?.accessToken){
      pendingGoogleCredential=GoogleAuthProvider.credential(x.idToken||null,x.accessToken||null);
      return pendingGoogleCredential;
    }
  }catch{}
  return null;
}

async function signInWithGoogle(){
  if(!auth)throw new Error("Firebase non è ancora configurato.");
  const provider=new GoogleAuthProvider();
  provider.setCustomParameters({prompt:"select_account"});
  try{
    if(window.matchMedia&&window.matchMedia("(max-width: 768px)").matches){
      await signInWithRedirect(auth,provider);
      return {redirect:true};
    }
    return await signInWithPopup(auth,provider);
  }catch(error){
    const code=error?.code||"";
    if(code==="auth/account-exists-with-different-credential"){
      try{storePendingGoogleCredential(GoogleAuthProvider.credentialFromError(error))}catch{storePendingGoogleCredential(null)}
      throw new Error("Esiste già un account Budget Reset con questa email. Accedi con email e password per collegare Google.");
    }
    if(code==="auth/operation-not-allowed"){
      throw new Error("Google non è abilitato tra i metodi di accesso del progetto Firebase. Controlla Authentication → Metodo di accesso → Google e premi Salva.");
    }
    if(code==="auth/unauthorized-domain"){
      throw new Error("Il dominio di Budget Reset non è autorizzato in Firebase Authentication. Aggiungi zirofy.app ai Domini autorizzati.");
    }
    throw error;
  }
}
async function finishGoogleLinkWithPassword(email,password){
  if(!auth||!pendingGoogleCredential)throw new Error("Nessun collegamento Google in sospeso.");
  const cred=await signInWithEmailAndPassword(auth,email,password);
  await linkWithCredential(cred.user,pendingGoogleCredential);
  storePendingGoogleCredential(null);
  return cred;
}
async function handleGoogleRedirectResult(){
  await ready;
  if(!auth)return;
  restorePendingGoogleCredential();
  try{
    const result=await getRedirectResult(auth);
    if(result?.user)dispatch("brcloud:google-login",{user:{uid:result.user.uid,email:result.user.email},redirect:true});
  }catch(error){
    const code=error?.code||"";
    if(code==="auth/account-exists-with-different-credential"){
      try{storePendingGoogleCredential(GoogleAuthProvider.credentialFromError(error))}catch{storePendingGoogleCredential(null)}
    }
    dispatch("brcloud:google-error",{code,message:error?.message||"Accesso Google non riuscito"});
  }
}

async function signUp(email,password){if(!auth)throw new Error("Firebase non è ancora configurato.");return createUserWithEmailAndPassword(auth,email,password)}
async function signIn(email,password){if(!auth)throw new Error("Firebase non è ancora configurato.");return signInWithEmailAndPassword(auth,email,password)}
async function resetPassword(email){if(!auth)throw new Error("Firebase non è ancora configurato.");return sendPasswordResetEmail(auth,email)}
async function logout(){if(auth)await signOut(auth)}
async function migrateLocal(){await ready;if(!currentUser)throw new Error("Accedi prima al tuo account.");let data={};try{data=JSON.parse(localStorage.getItem(legacyLocalKey)||"{}")}catch{}if(!hasUsefulData(data))throw new Error("Non ci sono vecchi dati locali da importare.");await pushToCloud(data,"migration")}
window.BRCloud={configured:firebaseConfigured,isOnline:()=>!!currentUser,signUp,signIn,signInWithGoogle,finishGoogleLinkWithPassword,resetPassword,logout,migrateLocal,save,syncNow,diagnose,getUser:()=>currentUser,whenReady:()=>ready};
startCloud().finally(()=>handleGoogleRedirectResult());
