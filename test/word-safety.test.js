import test from 'node:test';
import assert from 'node:assert/strict';
import {isInappropriateWord} from '../lib/wordSafety.js';
import {validateSingle,validateBatch} from '../lib/validation.js';
import {submissionEntries} from '../lib/surveyData.js';

test('blocks inappropriate terms in full phrases, punctuation, mixed case and disguised spellings',()=>{
 for(const word of ['fuck','FUCK!','f.u.c.k','f u c k','sh!t','shit!','sh1t','p0rn','n a k e d','Naked baby','apple and pornography','ＳＥＸ','s\u200bex','fúck','dildo','blowjob','boobs','sexting','cunt','bitch','slut'])assert.equal(isInappropriateWord(word),true,word);
 for(const word of ['class','grass','butterfly','peacock','cockatoo','shiitake','Sussex','Scunthorpe','Dickinson','Hancock','Daddy','Mommy','apple','box','fire truck'])assert.equal(isInappropriateWord(word),false,word);
});
test('single and batch word checks reject unsafe words before any AI request',async()=>{
 const client={responses:{create(){throw Error('must not call AI');}}};
 assert.equal((await validateSingle('N','naked',client)).valid,false);
 const results=await validateBatch([{letter:'S',word:'shit'},{letter:'P',word:'porn'},{letter:'A',word:'apple'}],client);
 assert.equal(results.S.valid,false);assert.equal(results.P.valid,false);assert.equal(results.A.valid,true);
});
test('final submission cannot bypass the safety filter with cached valid status',()=>{
 assert.throws(()=>submissionEntries({letters:{A:{word:'apple and porn',isDefault:false,status:'valid'}}},[]),/child-suitable word for a/);
});
