import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { initializeFirestore, memoryLocalCache, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig, firebaseConfigured } from "./firebase-config.js";

const dispatch=(name,detail={})=>window.dispatchEvent(new CustomEvent(name,{detail}));
const localKey="budget_reset_solo";
let auth=null;
let db=null;
let unsubscribe=null;
let currentUser=null;
let readyResolve=null;
const ready=new Promise(resolve=>{readyResolve=resolve});

function readLocal(){
  try{return JSON.parse(localStorage.getItem(localKey)||"{}")}catch{return {}}
}
function hasUsefulData(data=readLocal()){
  return Number(data.income||0)>0 ||
    Number(data.budget||0)>0 ||
    (Array.isArray(data.expenses)&&data.expenses.length>0) ||
    (Array.isArray(data.goals)&&data.goals.length>0) ||
    (Array.isArray(data.installments)&&data.installments.length>0) ||
    (Array.isArray(data.recurringExpenses)&&data.recurringExpenses.length>0);
}
function sameData(a,b){
  try{return JSON.stringify(a)===JSON.stringify(b)}catch{return false}
}

async function startCloud(){
  if(!firebaseConfigured){
    dispatch("brcloud:status",{configured:false,user:null,message:"Firebase non configurato"});
    readyResolve();
    return;
  }

  try{
    const app=initializeApp(firebaseConfig);
    auth=getAuth(app);

    try{
      db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
    }catch{
      db=initializeFirestore(app,{localCache:memoryLocalCache()});
    }

    onAuthStateChanged(auth,async user=>{
      currentUser=user||null;
      dispatch("brcloud:status",{
        configured:true,
        user:user?{uid:user.uid,email:user.email}:null,
        message:user?"Cloud attivo":"Non autenticato"
      });

      if(unsubscribe){unsubscribe();unsubscribe=null}
      if(!user){readyResolve();return}

      try{
        const ref=doc(db,"users",user.uid);
        const snap=await getDoc(ref);
        const local=readLocal();

        if(!snap.exists()){
          if(hasUsefulData(local)){
            await setDoc(ref,{budgetData:local,updatedAt:serverTimestamp(),email:user.email||null},{merge:true});
            dispatch("brcloud:sync",{direction:"upload",source:"local",data:local});
          }
        }else{
          const cloudData=snap.data()?.budgetData||null;
          if(cloudData&&hasUsefulData(cloudData)){
            if(!sameData(local,cloudData)){
              // Notify first; the page handler writes the new data and reloads once.
              dispatch("brcloud:loaded",{data:cloudData,source:"cloud"});
            }else{
              dispatch("brcloud:sync",{direction:"download",source:"cloud",data:cloudData});
            }
          }else if(hasUsefulData(local)){
            await setDoc(ref,{budgetData:local,updatedAt:serverTimestamp(),email:user.email||null},{merge:true});
            dispatch("brcloud:sync",{direction:"upload",source:"local",data:local});
          }
        }

        unsubscribe=onSnapshot(ref,snapshot=>{
          if(!snapshot.exists())return;
          const data=snapshot.data()?.budgetData;
          if(!data)return;
          const localNow=readLocal();
          if(snapshot.metadata.hasPendingWrites)return;
          if(!sameData(localNow,data)){
            dispatch("brcloud:loaded",{data,source:"cloud"});
          }
        });
      }catch(error){
        dispatch("brcloud:error",{message:error?.message||"Errore nella sincronizzazione Firebase"});
      }finally{
        readyResolve();
      }
    });
  }catch(error){
    dispatch("brcloud:error",{message:error?.message||"Impossibile inizializzare Firebase"});
    readyResolve();
  }
}

async function save(data){
  localStorage.setItem(localKey,JSON.stringify(data));
  await ready;
  if(!db||!currentUser)return {cloud:false};
  await setDoc(doc(db,"users",currentUser.uid),{
    budgetData:data,
    updatedAt:serverTimestamp(),
    email:currentUser.email||null
  },{merge:true});
  dispatch("brcloud:sync",{direction:"upload",source:"save",data});
  return {cloud:true};
}

async function signUp(email,password){
  if(!auth)throw new Error("Firebase non è ancora configurato.");
  return createUserWithEmailAndPassword(auth,email,password);
}
async function signIn(email,password){
  if(!auth)throw new Error("Firebase non è ancora configurato.");
  return signInWithEmailAndPassword(auth,email,password);
}
async function resetPassword(email){
  if(!auth)throw new Error("Firebase non è ancora configurato.");
  return sendPasswordResetEmail(auth,email);
}
async function logout(){if(auth)await signOut(auth)}
async function migrateLocal(){
  const data=readLocal();
  await ready;
  if(!data||!hasUsefulData(data))throw new Error("Non ci sono dati locali da importare.");
  if(!currentUser||!db)throw new Error("Accedi prima al tuo account.");
  await setDoc(doc(db,"users",currentUser.uid),{budgetData:data,updatedAt:serverTimestamp(),email:currentUser.email||null},{merge:true});
  dispatch("brcloud:sync",{direction:"upload",source:"migration",data});
}

window.BRCloud={
  configured:firebaseConfigured,
  isOnline:()=>!!currentUser,
  signUp,signIn,resetPassword,logout,migrateLocal,save,
  getUser:()=>currentUser,
  whenReady:()=>ready
};
startCloud();
