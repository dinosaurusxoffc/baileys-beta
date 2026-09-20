"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMsmsgDecryptionStrategies = exports.decodeDecryptedMsmsgMessage = exports.decryptMsmsgBotMessage = exports.decodeRichResponseMessage = void 0;
const WAProto_1 = require("../../WAProto");
const crypto_1 = require("./crypto");
const generics_1 = require("./generics");
const BOT_MESSAGE_INFO = 'Bot Message';
const KEY_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;
const MSG_ID_HEX_RE = /^[0-9A-Fa-f]{32}$/;
const toBuffer = (value) => {
    if (Buffer.isBuffer(value))
        return value;
    if (value instanceof Uint8Array)
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    return Buffer.from(value);
};
const normalizeLidJid = (jid) => {
    if (!jid || !jid.endsWith('@lid') || !jid.includes(':'))
        return jid;
    return `${jid.split(':')[0]}@lid`;
};
const buildMessageIdRepresentations = (messageId) => {
    const ascii = Buffer.from(messageId);
    const binary = MSG_ID_HEX_RE.test(messageId) ? Buffer.from(messageId, 'hex') : ascii;
    return [
        { label: 'msgIdAscii', value: ascii },
        ...(binary.equals(ascii) ? [] : [{ label: 'msgIdBinary', value: binary }])
    ];
};
const pushUnique = (items, seen, item) => {
    const key = JSON.stringify([item.messageId, item.idSource, item.idSources, item.infoSource, item.aadSource, item.info.toString('hex'), item.aad.toString('hex')]);
    if (!seen.has(key)) {
        seen.add(key);
        items.push(item);
    }
};
const getCandidateIds = (messageKey) => {
    const orderedCandidates = [
        messageKey.botType === 'full'
            ? { source: 'stanzaId', messageId: messageKey.stanzaId }
            : { source: 'botEditTargetId', messageId: messageKey.botEditTargetId },
        { source: 'targetId', messageId: messageKey.targetId },
        { source: 'metaTargetId', messageId: messageKey.metaTargetId },
        { source: 'stanzaId', messageId: messageKey.stanzaId }
    ];
    const targetIdCandidates = Array.isArray(messageKey.targetIdCandidates) ? messageKey.targetIdCandidates : [];
    for (let index = 0; index < targetIdCandidates.length; index++) {
        orderedCandidates.push({ source: `targetIdCandidates[${index}]`, messageId: targetIdCandidates[index] });
    }
    const grouped = new Map();
    for (const candidate of orderedCandidates) {
        if (!candidate.messageId)
            continue;
        const messageId = String(candidate.messageId);
        if (!grouped.has(messageId)) {
            grouped.set(messageId, { idSource: candidate.source, idSources: [candidate.source], messageId });
        }
        else {
            grouped.get(messageId).idSources.push(candidate.source);
        }
    }
    return Array.from(grouped.values());
};
const getJidCandidates = (messageKey) => {
    const ordered = [
        { source: 'meId', jid: messageKey.meId },
        { source: 'conversationJid', jid: messageKey.conversationJid },
        { source: 'senderJid', jid: messageKey.senderJid },
        { source: 'meLidNormalized', jid: normalizeLidJid(messageKey.meLid) }
    ];
    const seen = new Set();
    const candidates = [];
    for (const candidate of ordered) {
        if (!candidate.jid)
            continue;
        const jid = String(candidate.jid);
        if (!seen.has(jid)) {
            seen.add(jid);
            candidates.push({ source: candidate.source, jid, value: Buffer.from(jid) });
        }
    }
    return candidates;
};
const buildMsmsgDecryptionStrategies = (messageKey) => {
    const botJid = String(messageKey.participant || '');
    const botJidBuffer = Buffer.from(botJid);
    const targetIds = getCandidateIds(messageKey);
    const jidCandidates = getJidCandidates(messageKey);
    const primaryJid = jidCandidates[0];
    if (!primaryJid)
        return [];
    const alternateJid = jidCandidates.find(candidate => candidate.source !== primaryJid.source && candidate.jid !== botJid);
    const strategies = [];
    const seen = new Set();
    for (const idCandidate of targetIds) {
        const idForms = buildMessageIdRepresentations(idCandidate.messageId);
        for (const idForm of idForms) {
            pushUnique(strategies, seen, {
                mode: '2step', idSource: idCandidate.idSource, idSources: idCandidate.idSources,
                infoSource: `${idForm.label}+meId+botJid`, aadSource: `${idForm.label}+0+botJid`,
                authTagLayout: 'trailing', messageId: idCandidate.messageId,
                info: Buffer.concat([idForm.value, primaryJid.value, botJidBuffer, new Uint8Array(0)]),
                aad: Buffer.concat([idForm.value, Buffer.from([0]), botJidBuffer]),
                attemptLabel: `${idCandidate.idSource}:${idForm.label}:primary`
            });
            if (alternateJid) {
                pushUnique(strategies, seen, {
                    mode: '2step', idSource: idCandidate.idSource, idSources: idCandidate.idSources,
                    infoSource: `${idForm.label}+${alternateJid.source}+botJid`, aadSource: `${idForm.label}+0+${alternateJid.source}`,
                    authTagLayout: 'trailing', messageId: idCandidate.messageId,
                    info: Buffer.concat([idForm.value, alternateJid.value, botJidBuffer, new Uint8Array(0)]),
                    aad: Buffer.concat([idForm.value, Buffer.from([0]), alternateJid.value]),
                    attemptLabel: `${idCandidate.idSource}:${idForm.label}:${alternateJid.source}`
                });
            }
        }
    }
    return strategies.slice(0, 12);
};
exports.buildMsmsgDecryptionStrategies = buildMsmsgDecryptionStrategies;
const assertRequired = (value, label) => {
    if (!value || (value instanceof Uint8Array && value.byteLength === 0)) {
        throw new Error(`Missing required ${label} for msmsg decryption`);
    }
};
const decryptWithStrategy = async (messageSecret, msMsg, strategy) => {
    const baseSecret = await (0, crypto_1.hkdf)(toBuffer(messageSecret), KEY_LENGTH, { info: BOT_MESSAGE_INFO });
    const key = await (0, crypto_1.hkdf)(baseSecret, KEY_LENGTH, { info: strategy.info });
    const payload = toBuffer(msMsg.encPayload);
    const ciphertextWithTag = Buffer.concat([payload.slice(0, -AUTH_TAG_LENGTH), payload.slice(-AUTH_TAG_LENGTH)]);
    return (0, crypto_1.aesDecryptGCM)(ciphertextWithTag, key, toBuffer(msMsg.encIv), strategy.aad);
};
const decodeDecryptedMsmsgMessage = (decrypted) => {
    const messageBuffer = toBuffer(decrypted);
    try {
        const unpadded = Buffer.from((0, generics_1.unpadRandomMax16)(messageBuffer));
        const decoded = WAProto_1.proto.Message.decode(unpadded);
        const hasContent = Object.keys(decoded).some(key => key !== 'messageContextInfo' && decoded[key] != null);
        if (hasContent)
            return decoded;
    }
    catch { }
    return WAProto_1.proto.Message.decode(messageBuffer);
};
exports.decodeDecryptedMsmsgMessage = decodeDecryptedMsmsgMessage;
const decryptMsmsgBotMessage = async (messageSecret, messageKey, msMsg) => {
    assertRequired(messageSecret, 'messageSecret');
    assertRequired(messageKey.participant, 'participant');
    assertRequired(messageKey.meId, 'meId');
    assertRequired(msMsg.encIv, 'encIv');
    assertRequired(msMsg.encPayload, 'encPayload');
    if (getCandidateIds(messageKey).length === 0) {
        throw new Error('Missing required target message id for msmsg decryption');
    }
    const strategies = (0, exports.buildMsmsgDecryptionStrategies)(messageKey);
    const attemptedStrategies = [];
    let lastError;
    for (const strategy of strategies) {
        try {
            return decryptWithStrategy(messageSecret, msMsg, strategy);
        }
        catch (error) {
            attemptedStrategies.push({ idSource: strategy.idSource });
            lastError = error;
        }
    }
    const error = Object.assign(new Error('Failed to decrypt msmsg'), { attemptedStrategies, cause: lastError });
    throw error;
};
exports.decryptMsmsgBotMessage = decryptMsmsgBotMessage;
const decodeRichResponseMessage = (richMsg) => {
    try {
        if (!richMsg)
            return '';
        if (Array.isArray(richMsg.submessages) && richMsg.submessages.length > 0) {
            const sub = richMsg.submessages.map((s) => s.messageText).filter(Boolean).join('\n');
            if (sub)
                return sub;
        }
        const data = richMsg.unifiedResponse?.data;
        if (!data)
            return '';
        const json = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
        const texts = [];
        for (const section of json.sections || []) {
            const prim = section?.view_model?.primitive;
            if (prim?.text)
                texts.push(prim.text);
            if (prim?.header)
                texts.push(prim.header);
            for (const sub of section?.view_model?.items || []) {
                if (sub?.primitive?.text)
                    texts.push(sub.primitive.text);
            }
        }
        return texts.join('\n');
    }
    catch {
        return '';
    }
};
exports.decodeRichResponseMessage = decodeRichResponseMessage;