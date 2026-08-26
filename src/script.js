// ฟังก์ชันสลับ Tab
function switchTab(tabName) {
    const tabCollab = document.getElementById('tabCollab');
    const tabEvent = document.getElementById('tabEvent');
    const secCollab = document.getElementById('sectionCollaborator');
    const secEvent = document.getElementById('sectionEvent');

    if (!tabCollab || !tabEvent || !secCollab || !secEvent) return;

    if (tabName === 'collaborator') {
        tabCollab.classList.add('active');
        tabEvent.classList.remove('active');
        secCollab.style.display = 'block';
        secEvent.style.display = 'none';
    } else {
        tabEvent.classList.add('active');
        tabCollab.classList.remove('active');
        secEvent.style.display = 'block';
        secCollab.style.display = 'none';
    }
}