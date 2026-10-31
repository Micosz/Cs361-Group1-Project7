/* Named relationship choices; original form inputs remain the submission seam. */
(() => {
    'use strict';
    const mounts = new WeakMap();
    async function choices(kind, scope) {
        if (kind === 'partners') return (await window.CstuAuth.request('/selection-partners?scopeId='+encodeURIComponent(scope))).data;
        if (kind === 'participant' || kind === 'responsible') {
            return (await window.CstuAuth.request('/selection-users?scopeId='+encodeURIComponent(scope)+'&kind='+kind)).data;
        }
        const rows = []; let cursor = null;
        do {
            const result = await window.CstuAuth.request('/'+kind+'?scopeId='+encodeURIComponent(scope)+'&limit=100'+(cursor ? '&cursor='+encodeURIComponent(cursor) : ''));
            rows.push(...result.data); cursor = result.page.nextCursor;
        } while (cursor);
        return rows;
    }
    function mount({form, scope, fields, submit, status, onReady}) {
        mounts.get(form)?.();
        form.querySelector('[data-selection-fields]')?.remove();
        const box = document.createElement('fieldset'); box.dataset.selectionFields = '';
        const legend = document.createElement('legend'); legend.textContent = 'เลือกรายการที่เกี่ยวข้อง'; box.appendChild(legend);
        const controls = fields.map(({input,kind,label,multiple=true,required=false}) => {
            input.closest('p').hidden = true; input.required = false;
            const wrapper = document.createElement('p'), title = document.createElement('label');
            title.textContent = label; title.htmlFor = input.id+'-choice';
            const select = document.createElement('select'); select.id = title.htmlFor;
            select.multiple = multiple; select.required = required;
            select.style.cssText = 'display:block;width:100%;padding:.6rem;margin-top:.3rem;';
            if (multiple) select.size = 4;
            select.onchange = () => {
                input.value = [...select.selectedOptions].map(o => o.value).filter(Boolean).join(', ');
                updateReady();
            };
            wrapper.append(title,select); box.appendChild(wrapper);
            return {input,kind,select,multiple};
        });
        const hint=document.createElement('p');hint.textContent='เลือกได้หลายชื่อด้วย Ctrl/Command หรือ Shift';box.appendChild(hint);
        const retry=document.createElement('button');retry.type='button';retry.textContent='โหลดรายชื่ออีกครั้ง';retry.hidden=true;box.appendChild(retry);
        form.insertBefore(box,submit.closest('div')?.parentElement===form ? submit.closest('div') : submit.parentElement===form ? submit : form.firstChild);
        let revision=0,ready=false,loaded=false;
        function updateReady() {
            if (!loaded) return;
            const missing = controls.some(c => [...c.select.selectedOptions].some(o => o.dataset.unavailable === 'true'));
            const wasReady = ready;
            ready = !missing;
            submit.disabled = missing;
            retry.hidden = !missing;
            status.textContent = missing
                ? 'รายการเดิมบางรายการไม่อยู่ในตัวเลือกปัจจุบัน ตรวจสอบแล้วนำเครื่องหมายออก หรือโหลดรายชื่ออีกครั้งก่อนบันทึก การเปลี่ยนแปลงมีผลเมื่อกดบันทึก'
                : '';
            if (ready && !wasReady) onReady?.();
        }
        const guard = event => { if (!ready) { event.preventDefault(); event.stopImmediatePropagation(); status.textContent='กรุณารอรายชื่อโหลดสำเร็จก่อนบันทึก'; } };
        form.addEventListener('submit',guard,{capture:true});
        async function load(reset=false) {
            const run=++revision,selectedScope=typeof scope==='function'?scope():scope.value;
            ready=false;loaded=false;submit.disabled=true;retry.hidden=true;status.textContent='กำลังโหลดรายชื่อที่มีสิทธิ์เลือก';
            controls.forEach(c=>{c.select.disabled=true;if(reset)c.input.value='';});
            try {
                const all=await Promise.all(controls.map(c=>choices(c.kind,selectedScope)));
                if(run!==revision || !box.isConnected)return;
                controls.forEach((c,i)=>{
                    const selected=c.input.value.split(',').map(v=>v.trim()).filter(Boolean);
                    c.select.replaceChildren();
                    if(!c.multiple){const option=document.createElement('option');option.value='';option.textContent='ไม่ระบุ';c.select.appendChild(option);}
                    for(const row of all[i]){const option=document.createElement('option');option.value=row.id;option.textContent=row.name||row.title||row.displayName;option.selected=selected.includes(row.id);c.select.appendChild(option);}
                    for(const id of selected)if(!all[i].some(row=>row.id===id)){
                        const option=document.createElement('option');option.value=id;option.textContent='รายการเดิมที่ไม่อยู่ในตัวเลือกปัจจุบัน';option.dataset.unavailable='true';option.selected=true;c.select.appendChild(option);
                    }
                    if(!c.multiple)c.select.value=selected[0]||'';
                    c.select.disabled=false;
                });
                loaded=true;updateReady();
            } catch(error) {
                if(run!==revision||!box.isConnected)return;
                status.textContent='โหลดรายชื่อไม่ได้: '+error.message;retry.hidden=false;
            }
        }
        retry.onclick=()=>load();
        const scopeChanged=()=>load(true);
        if(typeof scope!=='function')scope.addEventListener('change',scopeChanged);
        mounts.set(form,()=>{revision++;form.removeEventListener('submit',guard,{capture:true});if(typeof scope!=='function')scope.removeEventListener('change',scopeChanged);});
        load();
        return {ready:()=>ready};
    }
    window.SelectionFields={mount};
})();
