import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { initializeFirestore, memoryLocalCache, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig, firebaseConfigured } from "./firebase-config.js";

const dispatch=(name,detail={})=>window.dispatchEvent(new CustomEvent(name,{detail}));
const localKey="budget_reset_solo";
let auth=null,db=null,unsubscribe=null,currentUser=null,readyResolve=null;
const ready=new Promise(resolve=>{readyResolve=resolve});

function readLocal(){try{return JSON.parse(localStorage.getItem(localKey)||"{}")}catch{return {}}}
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
  localStorage.setItem(localKey,JSON.stringify(data));
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
  const local=readLocal();
  if(!cloudData)return {action:"none"};
  const cloudTs=Number(cloudUpdatedAt||cloudData?._sync?.updatedAt||0);
  const localTs=localTimestamp(local);
  if(!hasUsefulData(local)&&hasUsefulData(cloudData)){
    localStorage.setItem(localKey,JSON.stringify({...cloudData,_sync:{updatedAt:cloudTs||Date.now()}}));
    dispatch("brcloud:loaded",{data:cloudData,source:"cloud"});
    return {action:"download"};
  }
  if(cloudTs>localTs&&cloudTs>0&&!sameData(local,cloudData)){
    localStorage.setItem(localKey,JSON.stringify({...cloudData,_sync:{updatedAt:cloudTs}}));
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

async function syncNow(){
  await ready;
  if(!db||!currentUser)throw new Error("Accedi a Budget Reset prima di sincronizzare.");
  const ref=doc(db,"users",currentUser.uid);
  const snap=await getDoc(ref);
  const local=readLocal();
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
        const ref=doc(db,"users",user.uid),snap=await getDoc(ref),local=readLocal();
        if(!snap.exists()){
          if(hasUsefulData(local))await pushToCloud(local,"first-login");
          else dispatch("brcloud:sync",{direction:"ready",source:"cloud",data:local});
        }else{
          const cloudData=snap.data()?.budgetData||null,cloudTs=Number(snap.data()?.clientUpdatedAt||cloudData?._sync?.updatedAt||0);
          await applyCloudData(cloudData,cloudTs);
        }
        unsubscribe=onSnapshot(ref,snapshot=>{
          if(!snapshot.exists()||snapshot.metadata.hasPendingWrites)return;
          const cloudData=snapshot.data()?.budgetData;if(!cloudData)return;
          const cloudTs=Number(snapshot.data()?.clientUpdatedAt||cloudData?._sync?.updatedAt||0);
          const localNow=readLocal();
          if(cloudTs>localTimestamp(localNow)&&!sameData(localNow,cloudData)){
            dispatch("brcloud:loaded",{data:cloudData,source:"realtime"});
          }
        });
      }catch(error){dispatch("brcloud:error",{message:error?.message||"Errore nella sincronizzazione Firebase"})}
      finally{readyResolve()}
    });
  }catch(error){dispatch("brcloud:error",{message:error?.message||"Impossibile inizializzare Firebase"});readyResolve()}
}

async function save(data){
  localStorage.setItem(localKey,JSON.stringify(data));
  await ready;
  if(!db||!currentUser)return {cloud:false};
  return {cloud:true,data:await pushToCloud(data,"save")};
}
async function signUp(email,password){if(!auth)throw new Error("Firebase non è ancora configurato.");return createUserWithEmailAndPassword(auth,email,password)}
async function signIn(email,password){if(!auth)throw new Error("Firebase non è ancora configurato.");return signInWithEmailAndPassword(auth,email,password)}
async function resetPassword(email){if(!auth)throw new Error("Firebase non è ancora configurato.");return sendPasswordResetEmail(auth,email)}
async function logout(){if(auth)await signOut(auth)}
async function migrateLocal(){const data=readLocal();await ready;if(!hasUsefulData(data))throw new Error("Non ci sono dati locali da importare.");await pushToCloud(data,"migration")}
window.BRCloud={configured:firebaseConfigured,isOnline:()=>!!currentUser,signUp,signIn,resetPassword,logout,migrateLocal,save,syncNow,getUser:()=>currentUser,whenReady:()=>ready};
startCloud();
