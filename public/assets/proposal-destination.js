/* Review the registered destination and the signed period separately from internal approval. */
window.CstuProposalDestination = function (app) {
    'use strict';
    const {$, node, button, auth, proposalPath} = app;
    const box = $('proposal-destination-panel');
    const names = {activity:'สร้างกิจกรรมจากข้อเสนอนี้', exchange:'สร้างโครงการ Exchange', agreement:'สร้างทะเบียนข้อตกลง'};
    const paths = {activity:'activities', exchange:'exchanges', agreement:'agreements'};
    const types = {event:'กิจกรรมทั่วไป', academic_activity:'กิจกรรมวิชาการ', research:'งานวิจัย'};
    let generation = 0;
    function field(form, label, tag, name, type) {
        const wrapper = node('label',label), input = node(tag);
        if (type) input.type = type;
        input.name = name; input.required = true;
        wrapper.append(input); form.append(wrapper);
        return input;
    }
    function send(form, text) {
        const submit = node('button',text); submit.type='submit'; form.append(submit);
    }
    function period(row) { return (row.startDate || 'ยังไม่ระบุ') + ' ถึง ' + (row.endDate || 'ยังไม่ระบุ'); }
    function needsDateConfirmation(registered, signed) {
        return ['startDate','endDate'].some(k => registered?.[k] && signed[k] && registered[k] !== signed[k]);
    }
    function periodConfirmation(form) {
        const label = node('label',null,'proposal-check');
        const confirm = node('input'); confirm.type='checkbox'; confirm.name='confirmDates';
        const copy = node('span'); label.append(confirm,copy); form.append(label);
        return (registered,signed) => {
            const needed = needsDateConfirmation(registered,signed);
            label.hidden = !needed; confirm.required = needed; confirm.checked = false;
            copy.textContent = needed ? 'ยืนยันปรับช่วงวันที่ในทะเบียนจาก ' + period(registered) + ' เป็น ' + period(signed) : '';
        };
    }
    function previewEditor(ctx, preview, mode, holder) {
        const {row,current,act} = ctx;
        const form = node('form'); form.id='proposal-destination-form';
        form.append(node('h4', mode === 'link' ? 'เลือกทะเบียนข้อตกลงเดิม' : 'ตรวจข้อมูลก่อนสร้าง'));
        let fields;
        if (mode === 'link') {
            const choice = field(form,'ข้อตกลง MoU ในหลักสูตร','select','agreementId');
            choice.append(new Option('เลือกข้อตกลง',''));
            for (const a of preview.agreements) choice.append(new Option(a.title,a.id));
            const check = periodConfirmation(form), selected = () => preview.agreements.find(a => a.id === choice.value);
            choice.onchange = () => check(selected(),row.signed || {});
            choice.onchange();
            fields = () => ({mode:'link', agreementId:choice.value, agreementVersion:selected().version,
                ...(form.elements.confirmDates.checked ? {confirmDates:true} : {})});
        } else {
            const title = field(form,'ชื่อรายการปลายทาง','input','title','text'); title.maxLength=200; title.value=preview.title;
            form.append(node('p','รายละเอียด · ' + preview.summary), node('p','คู่จากข้อเสนอ · ' + preview.partnerName));
            const partner = field(form,'องค์กรที่บันทึกในรายการปลายทาง','select','partnerId');
            partner.append(new Option('เลือกองค์กรจาก Collaborator',''));
            for (const p of preview.partners) partner.append(new Option(p.name,p.id));
            partner.value = preview.partnerId || '';
            if (!preview.partnerId) form.append(node('small','เลือกองค์กรที่ร่วมจัดจากทะเบียน Collaborator ชื่อคู่จากข้อเสนอยังแสดงในเรื่องต้นทาง'));
            form.append(node('p','เจ้าภาพหลักในรายการปลายทาง · ' + preview.hostName));
            if (preview.kind === 'activity') {
                const type = field(form,'ประเภทกิจกรรม','select','activityType');
                for (const [value,label] of Object.entries(types)) type.append(new Option(label,value));
            }
            fields = () => ({mode:'create', title:title.value.trim(),partnerId:partner.value,
                ...(preview.kind === 'activity' ? {activityType:form.elements.activityType.value} : {})});
        }
        send(form,mode === 'link' ? 'ยืนยันเชื่อมข้อตกลง' : 'ยืนยันสร้างรายการ');
        form.onsubmit = event => {
            event.preventDefault();
            const payload = fields();
            act(() => app.write(current,row,'/destination',payload), 'เชื่อมรายการกับข้อเสนอแล้ว');
        };
        holder.replaceChildren(form);
        form.querySelector('input,select')?.focus();
    }
    function signing(ctx) {
        const {row,current,act,fileLink} = ctx;
        if (row.signed) {
            const signed = row.signed;
            box.append(node('h3','หลักฐานการลงนาม'),node('p','ลงนามวันที่ ' + signed.signedOn),
                node('p','ช่วงที่มีผล · ' + period(signed)));
            const proof = row.files.find(f => f.id === signed.evidenceId);
            if (proof) box.append(fileLink(row,proof,'เปิดหลักฐานการลงนาม · ' + proof.displayName));
            return;
        }
        if (!row.canSign) return;
        const details = node('details',null,'proposal-support'); details.id='proposal-signing';
        details.append(node('summary','บันทึกหลักฐานและวันที่ลงนาม'));
        const evidence = row.files.filter(f => f.purpose === 'evidence');
        const upload = node('form');
        const file = field(upload,'ไฟล์หลักฐานการลงนาม','input','evidenceFile','file'); file.accept='.pdf,.png,.jpg,.jpeg';
        send(upload,'แนบหลักฐานการลงนาม');
        upload.onsubmit = event => { event.preventDefault(); act(() => app.upload(current,row,'evidence',file.files[0]),'แนบหลักฐานแล้ว กรุณาระบุวันที่ลงนามและช่วงที่มีผล'); };
        details.append(upload);
        if (evidence.length) {
            const form = node('form'); form.id='proposal-sign-form';
            const select = field(form,'หลักฐานที่จะบันทึก','select','evidenceId');
            for (const f of evidence) select.append(new Option(f.displayName,f.id));
            select.value = evidence.at(-1).id;
            field(form,'วันที่ลงนาม','input','signedOn','date');
            const start = field(form,'วันที่เริ่มมีผล','input','startDate','date');
            const end = field(form,'วันที่สิ้นสุด','input','endDate','date');
            if (row.destination) {
                start.value = row.destination.startDate || ''; end.value = row.destination.endDate || '';
                form.append(node('small','ช่วงปัจจุบันในทะเบียน · ' + period(row.destination)));
            }
            const check = periodConfirmation(form);
            function dates() { end.min = start.value; check(row.destination,{startDate:start.value,endDate:end.value}); }
            start.oninput = end.oninput = dates; dates();
            send(form,'บันทึกการลงนาม');
            form.onsubmit = event => {
                event.preventDefault();
                const payload = {revision:row.approvedRevision,evidenceId:select.value,signedOn:form.elements.signedOn.value,
                    startDate:start.value,endDate:end.value, ...(row.destination ? {agreementVersion:row.destination.version} : {}),
                    ...(form.elements.confirmDates.checked ? {confirmDates:true} : {})};
                act(() => app.write(current,row,'/signing',payload),'บันทึกหลักฐาน วันที่ลงนาม และช่วงที่มีผลแล้ว');
            };
            details.append(form);
        }
        details.open = evidence.length > 0; box.append(details);
    }
    function clear() { generation++; box.replaceChildren(); }
    async function render(ctx) {
        clear();
        const {row} = ctx, run = generation;
        if (row.legacy) return;
        signing(ctx);
        if (row.destination) {
            const target = row.destination;
            const a = node('a','เปิดรายการที่เชื่อม · ' + target.title);
            a.href = 'work.html?kind=' + paths[target.kind] + '&id=' + encodeURIComponent(target.id) + '#board-section';
            box.append(node('h3','รายการที่เชื่อม'),a);
            return;
        }
        if (row.hasDestination) {
            box.append(node('p','เชื่อมงานปลายทางแล้ว รายละเอียดรายการแสดงให้บัญชีที่ได้รับสิทธิ์'));
            return;
        }
        const ready = row.kind === 'mou' ? ['signing','signed'].includes(row.status) : row.status === 'closed';
        if (!ready) return;
        try {
            const {data} = await auth.request(proposalPath(row) + '/destination');
            if (run !== generation || !ctx.valid()) return;
            if (!data.canCreate && !data.canLink) {
                if (row.isOwner && row.hostId && row.hostId !== ctx.current.session.user.id)
                    box.append(node('p','รอเจ้าภาพหลักเปิดรายการปลายทางตามสิทธิ์'));
                return;
            }
            const controls = node('div',null,'proposal-tools'), holder = node('div');
            if (data.canCreate) controls.append(button(names[data.kind],() => previewEditor(ctx,data,'create',holder)));
            if (data.canLink && data.agreements.length) controls.append(button('เชื่อมข้อตกลงเดิม',() => previewEditor(ctx,data,'link',holder)));
            if (controls.childElementCount) box.append(node('h3','งานปลายทาง'),controls,holder);
        } catch (error) {
            if (run === generation && ctx.valid())
                box.append(node('p','โหลดงานปลายทางไม่ได้ · ' + app.message(error)),button('โหลดงานปลายทางอีกครั้ง',() => render(ctx)));
        }
    }
    return {render,clear};
};
