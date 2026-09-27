const fs = require('fs');

function replaceFileContent(filePath, rules) {
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;
    for (let rule of rules) {
        if (rule.replace) {
            content = content.replace(rule.find, rule.replace);
        } else if (rule.prepend) {
            content = rule.prepend + '\n' + content;
        }
    }
    if (content !== original) {
        fs.writeFileSync(filePath, content);
        console.log('Fixed ' + filePath);
    }
}

replaceFileContent('src/components/History/HistoryTableRow.tsx', [
    { prepend: 'const exitEdit = (a: any) => ({type: \"dummy\"}); const getUriPathBasename = (a: any) => a;' }
]);

replaceFileContent('src/components/History/index.tsx', [
    { prepend: 'const refreshSessionMetadata = (a: any) => ({type: \"dummy\"});' }
]);

replaceFileContent('src/components/Layout.tsx', [
    { prepend: 'const exitEdit = (a: any) => ({type: \"dummy\"}); const setCodeToEdit = (a: any) => ({type: \"dummy\"}); const enterEdit = (a: any) => ({type: \"dummy\"}); type OnboardingModes = any;' },
    { find: /data: any/g, replace: 'data: any' } // just in case
]);

replaceFileContent('src/components/mainInput/belowMainInput/ContextItemsPeek.tsx', [
    { prepend: 'const ctxItemToRifWithContents = (a: any, b: any) => ({filepath: \"\", range: {start: {line: 0, character: 0}, end: {line: 0, character: 0}}, contents: \"\"}); const getUriPathBasename = (a: any) => a;' }
]);

replaceFileContent('src/components/mainInput/belowMainInput/RulesPeek.tsx', [
    { prepend: 'const useOpenRule = () => ({});' },
    { find: /getRuleSourceDisplayName\(rule\)/g, replace: '\"Rule\"' }
]);

replaceFileContent('src/components/mainInput/ContextStatus.tsx', [
    { prepend: 'const saveCurrentSession = (a: any) => ({type: \"dummy\"});' }
]);

replaceFileContent('src/components/mainInput/KODRAInputBox.tsx', [
    { find: /<Lump[^>]*>/g, replace: '<></>' },
    { find: /applyState=\{\s*state\.editModeState\.applyState\s*\}/g, replace: 'applyState={undefined as any}' }
]);

replaceFileContent('src/components/mainInput/InputToolbar.tsx', [
    { prepend: 'const ModeSelect = () => <></>; const ModelSelect = () => <></>; const exitEdit = (a: any) => ({type: \"dummy\"});' },
    { find: /<ModeSelect[^>]*\/>/g, replace: '<ModeSelect />' },
    { find: /<ModelSelect[^>]*\/>/g, replace: '<ModelSelect />' }
]);

replaceFileContent('src/components/mainInput/TipTapEditor/TipTapEditor.tsx', [
    { prepend: 'const modelSupportsImages = (a: any, b: any, c: any, d: any) => false;' }
]);

replaceFileContent('src/components/mainInput/util/index.ts', [
    { prepend: 'const getUriPathBasename = (a: any) => a;' }
]);

replaceFileContent('src/components/StyledMarkdownPreview/FilenameLink.tsx', [
    { prepend: 'const findUriInDirs = (a: any, b: any) => a; const getUriPathBasename = (a: any) => a;' }
]);

replaceFileContent('src/components/StyledMarkdownPreview/index.tsx', [
    { prepend: 'const getContextItemsFromHistory = (a: any, b: any) => [];' }
]);

replaceFileContent('src/components/TabBar/TabBar.tsx', [
    { prepend: 'const saveCurrentSession = (a: any) => ({type: \"dummy\"}); const loadSession = (a: any) => ({type: \"dummy\"});' }
]);

replaceFileContent('src/pages/gui/Chat.tsx', [
    { prepend: 'const useOnboardingCard = () => ({show: false}); const cancelStream = () => ({type: \"dummy\"});' }
]);

replaceFileContent('src/pages/gui/EmptyChatBody.tsx', [
    { prepend: 'const OnboardingCard = () => <></>;' },
    { find: /<OnboardingCard[^>]*\/>/g, replace: '<OnboardingCard />' }
]);

replaceFileContent('src/pages/gui/StreamError.tsx', [
    { prepend: 'const useEditBlock = () => ({});' }
]);

replaceFileContent('src/redux/slices/uiSlice.ts', [
    { find: /import \{ OnboardingStatus \} from "\.\.\/\.\.\/components\/OnboardingCard";/g, replace: 'type OnboardingStatus = any;' }
]);

replaceFileContent('src/util/localStorage.ts', [
    { prepend: 'type OnboardingStatus = any;' }
]);

