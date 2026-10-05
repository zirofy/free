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

function hasUsefulLocalData(){
  try{
    const raw=localStorage.getItem(localKey);
    if(!raw)return false;
    const data=JSON.parse(raw);
    return Number(data.income||0)>0 ||
      Number(data.budget||0)>0 ||
      (Array.isArray(data.expenses)&&data.expenses.length>0) ||
      (Array.isArray(data.goals)&&data.goals.length>0) ||
      (Array.isArray(data.installments)&&data.installments.length>0) ||
      (Array.isArray(data.recurringExpenses)&&data.recurringExpenses.length>0);
  }catch{return false}
}

async function startCloud(){
  if(!firebaseConfigured){
    dispatch("brcloud:status",{configured:false,user:null,message:"Firebase non configurato"});
    return;
  }

  try{
    const app=initializeApp(firebaseConfig);
    auth=getAuth(app);

    try{
      db=initializeFirestore(app,{
        localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})
      });
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
      if(!user)return;

      const ref=doc(db,"users",user.uid);
      const snap=await getDoc(ref);

      if(!snap.exists()){
        if(hasUsefulLocalData())dispatch("brcloud:local-found",{user:{uid:user.uid,email:user.email}});
        return;
      }

      const cloudData=snap.data()?.budgetData;
      if(cloudData){
        localStorage.setItem(localKey,JSON.stringify(cloudData));
        dispatch("brcloud:loaded",{data:cloudData,source:"cloud"});
      }

      unsubscribe=onSnapshot(ref,snapshot=>{
        if(!snapshot.exists())return;
        const data=snapshot.data()?.budgetData;
        if(!data)return;
        localStorage.setItem(localKey,JSON.stringify(data));
        if(!snapshot.metadata.hasPendingWrites){
          dispatch("brcloud:loaded",{data,source:"cloud"});
        }
      });
    });
  }catch(error){
    dispatch("brcloud:error",{message:error?.message||"Impossibile inizializzare Firebase"});
  }
}

async function save(data){
  localStorage.setItem(localKey,JSON.stringify(data));
  if(!db||!currentUser)return {cloud:false};
  await setDoc(doc(db,"users",currentUser.uid),{
    budgetData:data,
    updatedAt:serverTimestamp(),
    email:currentUser.email||null
  },{merge:true});
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
async function logout(){
  if(auth)await signOut(auth);
}
async function migrateLocal(){
  const raw=localStorage.getItem(localKey);
  if(!raw)throw new Error("Non ci sono dati locali da importare.");
  if(!currentUser||!db)throw new Error("Accedi prima al tuo account.");
  const data=JSON.parse(raw);
  await setDoc(doc(db,"users",currentUser.uid),{
    budgetData:data,
    updatedAt:serverTimestamp(),
    email:currentUser.email||null
  },{merge:true});
  dispatch("brcloud:loaded",{data,source:"migration"});
}

window.BRCloud={configured:firebaseConfigured,isOnline:()=>!!currentUser,signUp,signIn,resetPassword,logout,migrateLocal,save,getUser:()=>currentUser};
startCloud();
