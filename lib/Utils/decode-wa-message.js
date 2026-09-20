"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decryptMessageNode = exports.NACK_REASONS = exports.MISSING_KEYS_ERROR_TEXT = exports.NO_MESSAGE_FOUND_ERROR_TEXT = void 0;
exports.decodeMessageNode = decodeMessageNode;
const boom_1 = require("@hapi/boom");
const WAProto_1 = require("../../WAProto");
const WABinary_1 = require("../WABinary");
const generics_1 = require("./generics");
const meta_ai_msmsg_1 = require("./meta-ai-msmsg");
const crypto_1 = require("./crypto");
const MAX_SECRETS_PER_CHAT = 20;
const botMessageSecrets = new Map();
const botRecentSecretsByChat = new Map();
const pushRecentChatSecret = (chatJid, id, secretBuf) => {
    if (!chatJid || !secretBuf)
        return;
    const existing = botRecentSecretsByChat.get(chatJid) || [];
    const filtered = existing.filter(item => item.id !== id && !item.secret.equals(secretBuf));
    filtered.unshift({ id, secret: secretBuf });
    if (filtered.length > MAX_SECRETS_PER_CHAT)
        filtered.length = MAX_SECRETS_PER_CHAT;
    botRecentSecretsByChat.set(chatJid, filtered);
};
const setBotMessageSecret = (id, secret, chatJid) => {
    if (!id || !secret)
        return;
    let buf;
    if (Buffer.isBuffer(secret)) {
        buf = secret;
    }
    else if (secret instanceof Uint8Array) {
        buf = Buffer.from(secret.buffer, secret.byteOffset, secret.byteLength);
    }
    else if (typeof secret === 'string') {
        buf = Buffer.from(secret, 'base64');
    }
    else {
        return;
    }
    botMessageSecrets.set(id, buf);
    if (chatJid)
        pushRecentChatSecret(chatJid, id, buf);
};
exports.setBotMessageSecret = setBotMessageSecret;
exports.NO_MESSAGE_FOUND_ERROR_TEXT = 'Message absent from node';
exports.MISSING_KEYS_ERROR_TEXT = 'Key used already or never filled';
exports.NACK_REASONS = {
    ParsingError: 487,
    UnrecognizedStanza: 488,
    UnrecognizedStanzaClass: 489,
    UnrecognizedStanzaType: 490,
    InvalidProtobuf: 491,
    InvalidHostedCompanionStanza: 493,
    MissingMessageSecret: 495,
    SignalErrorOldCounter: 496,
    MessageDeletedOnPeer: 499,
    UnhandledError: 500,
    UnsupportedAdminRevoke: 550,
    UnsupportedLIDGroup: 551,
    DBOperationFailed: 552
};
/**
 * Decode the received node as a message.
 * @note this will only parse the message, not decrypt it
 */
function decodeMessageNode(stanza, meId, meLid) {
    var _a, _b, _c, _d, _e, _f, _g;
    let msgType;
    let chatId;
    let author;
    const msgId = stanza.attrs.id;
    const from = stanza.attrs.from;
    const senderPn = (_a = stanza === null || stanza === void 0 ? void 0 : stanza.attrs) === null || _a === void 0 ? void 0 : _a.sender_pn;
    const senderLid = (_b = stanza === null || stanza === void 0 ? void 0 : stanza.attrs) === null || _b === void 0 ? void 0 : _b.sender_lid;
    const participant = stanza.attrs.participant;
    const participantLid = (_c = stanza === null || stanza === void 0 ? void 0 : stanza.attrs) === null || _c === void 0 ? void 0 : _c.participant_lid;
    const recipient = stanza.attrs.recipient;
    const isMe = (jid) => (0, WABinary_1.areJidsSameUser)(jid, meId);
    const isMeLid = (jid) => (0, WABinary_1.areJidsSameUser)(jid, meLid);
    if ((0, WABinary_1.isJidUser)(from) || (0, WABinary_1.isLidUser)(from)) {
        if (recipient && !(0, WABinary_1.isJidMetaAi)(recipient)) {
            if (!isMe(from) && !isMeLid(from)) {
                throw new boom_1.Boom('receipient present, but msg not from me', { data: stanza });
            }
            chatId = recipient;
        }
        else {
            chatId = from;
        }
        msgType = 'chat';
        author = from;
    }
    else if ((0, WABinary_1.isJidGroup)(from)) {
        if (!participant) {
            throw new boom_1.Boom('No participant in group message');
        }
        msgType = 'group';
        author = participant;
        chatId = from;
    }
    else if ((0, WABinary_1.isJidMetaAi)(from)) {
        msgType = 'chat';
        chatId = from;
        author = from;
    }
    else if ((0, WABinary_1.isJidNewsletter)(from)) {
        msgType = 'newsletter';
        author = from;
        chatId = from;
    }
    else if ((0, WABinary_1.isJidBroadcast)(from)) {
        if (!participant) {
            throw new boom_1.Boom('No participant in group message');
        }
        const isParticipantMe = isMe(participant);
        if ((0, WABinary_1.isJidStatusBroadcast)(from)) {
            msgType = isParticipantMe ? 'direct_peer_status' : 'other_status';
        }
        else {
            msgType = isParticipantMe ? 'peer_broadcast' : 'other_broadcast';
        }
        chatId = from;
        author = participant;
    }
    else {
        throw new boom_1.Boom('Unknown message type', { data: stanza });
    }
    const fromMe = (0, WABinary_1.isJidNewsletter)(from) ? !!((_d = stanza.attrs) === null || _d === void 0 ? void 0 : _d.is_sender) || false : ((0, WABinary_1.isLidUser)(from) ? isMeLid : isMe)(stanza.attrs.participant || stanza.attrs.from);
    const pushname = (_e = stanza === null || stanza === void 0 ? void 0 : stanza.attrs) === null || _e === void 0 ? void 0 : _e.notify;
    const key = {
        remoteJid: chatId,
        fromMe,
        id: msgId,
        senderPn,
        senderLid,
        participant,
        participantLid,
        'server_id': (_f = stanza.attrs) === null || _f === void 0 ? void 0 : _f.server_id
    };
    const fullMessage = {
        key,
        messageTimestamp: +stanza.attrs.t,
        pushName: pushname,
        broadcast: (0, WABinary_1.isJidBroadcast)(from)
    };
    if (msgType === 'newsletter') {
        fullMessage.newsletterServerId = +((_g = stanza.attrs) === null || _g === void 0 ? void 0 : _g.server_id);
    }
    if (key.fromMe) {
        fullMessage.status = WAProto_1.proto.WebMessageInfo.Status.SERVER_ACK;
    }
    return {
        fullMessage,
        author,
        sender: msgType === 'chat' ? author : chatId
    };
}
const decryptMessageNode = (stanza, meId, meLid, repository, logger) => {
    const { fullMessage, author, sender } = decodeMessageNode(stanza, meId, meLid);
    return {
        fullMessage,
        category: stanza.attrs.category,
        author,
        async decrypt() {
            var _a;
            let decryptables = 0;
            let metaTargetId = null;
            let botEditTargetId = null;
            let botType = null;            
            if (Array.isArray(stanza.content)) {
                for (const { tag, attrs, content } of stanza.content) {
                    if (tag === 'meta' && attrs?.target_id) metaTargetId = attrs.target_id;
                    if (tag === 'bot' && attrs && 'edit_target_id' in attrs) botEditTargetId = attrs.edit_target_id;
                    if (tag === 'bot' && attrs?.edit) botType = attrs.edit;                
                    if (tag === 'verified_name' && content instanceof Uint8Array) {
                        const cert = WAProto_1.proto.VerifiedNameCertificate.decode(content);
                        const details = WAProto_1.proto.VerifiedNameCertificate.Details.decode(cert.details);
                        fullMessage.verifiedBizName = details.verifiedName;
                    }
                    if (tag === 'unavailable' && attrs.type === 'view_once') {
                        fullMessage.key.isViewOnce = true;
                    }
                    if (tag !== 'enc' && tag !== 'plaintext') {
                        continue;
                    }
                    if (!(content instanceof Uint8Array)) {
                        continue;
                    }
                    decryptables += 1;
                    let msgBuffer;
                    try {
                        const e2eType = tag === 'plaintext' ? 'plaintext' : attrs.type;
                        switch (e2eType) {
                            case 'skmsg':
                                msgBuffer = await repository.decryptGroupMessage({
                                    group: sender,
                                    authorJid: author,
                                    msg: content
                                });
                                break;
                            case 'pkmsg':
                            case 'msg':
                                const user = (0, WABinary_1.isJidUser)(sender) ? sender : author;
                                msgBuffer = await repository.decryptMessage({
                                    jid: user,
                                    type: e2eType,
                                    ciphertext: content
                                });
                                break;
                            case 'plaintext':
                                msgBuffer = content;
                                break;
                            case undefined:
                                msgBuffer = content;
                                break;
                            case 'msmsg': {
                                if (botType !== null && !['full', 'last'].includes(botType))
                                    break;
                                const secretIdCandidates = [botEditTargetId, metaTargetId, fullMessage.key?.id].filter(Boolean);
                                const secretCandidates = [];
                                const seenSecrets = new Set();
                                for (const idCandidate of secretIdCandidates) {
                                    const byId = botMessageSecrets.get(idCandidate);
                                    if (!byId)
                                        continue;
                                    const fp = byId.toString('hex');
                                    if (!seenSecrets.has(fp)) {
                                        seenSecrets.add(fp);
                                        secretCandidates.push({ source: `id:${idCandidate}`, secret: byId });
                                    }
                                }
                                const chatRecent = botRecentSecretsByChat.get(sender) || [];
                                for (const item of chatRecent) {
                                    const fp = item.secret.toString('hex');
                                    if (!seenSecrets.has(fp)) {
                                        seenSecrets.add(fp);
                                        secretCandidates.push({ source: `chat:${item.id}`, secret: item.secret });
                                    }
                                    if (secretCandidates.length >= 6)
                                        break;
                                }
                                if (!secretCandidates.length)
                                    break;
                                const msMsg = WAProto_1.proto.MessageSecretMessage.decode(content);
                                const helperKey = {
                                    participant: author,
                                    meId: meLid ? `${meLid.split(':')[0]}@lid` : meId,
                                    meLid,
                                    conversationJid: sender,
                                    botType,
                                    botEditTargetId,
                                    metaTargetId,
                                    stanzaId: stanza.attrs?.id,
                                    targetId: botEditTargetId || metaTargetId || stanza.attrs?.id,
                                    targetIdCandidates: secretIdCandidates
                                };
                                let decryptErr;
                                for (const candidate of secretCandidates) {
                                    try {
                                        msgBuffer = await (0, meta_ai_msmsg_1.decryptMsmsgBotMessage)(candidate.secret, helperKey, msMsg);
                                        break;
                                    }
                                    catch (e) {
                                        decryptErr = e;
                                    }
                                }
                                if (!msgBuffer && decryptErr)
                                    throw decryptErr;
                                break;
                            }                                
                            default:
                                throw new Error(`Unknown e2e type: ${e2eType}`);
                        }
                        let msg = e2eType === 'msmsg'
                            ? (0, meta_ai_msmsg_1.decodeDecryptedMsmsgMessage)(msgBuffer)
                            : WAProto_1.proto.Message.decode(e2eType !== 'plaintext' ? (0, generics_1.unpadRandomMax16)(msgBuffer) : msgBuffer);
                        msg = ((_a = msg === null || msg === void 0 ? void 0 : msg.deviceSentMessage) === null || _a === void 0 ? void 0 : _a.message) || msg;
                        if (msg.senderKeyDistributionMessage) {
                            try {
                                await repository.processSenderKeyDistributionMessage({
                                    authorJid: author,
                                    item: msg.senderKeyDistributionMessage
                                });
                            }
                            catch (err) {
                                logger.error({ key: fullMessage.key, err }, 'failed to decrypt message');
                            }
                        }
                        if (fullMessage.message) {
                            Object.assign(fullMessage.message, msg);
                        }
                        else {
                            fullMessage.message = msg;
                        }
                        const rich = fullMessage.message?.richResponseMessage;
                        if (rich && !rich.text) {
                            const decoded = (0, meta_ai_msmsg_1.decodeRichResponseMessage)(rich);
                            if (decoded)
                                rich.text = decoded;
                        }
                        const editedRich = fullMessage.message?.protocolMessage?.editedMessage?.richResponseMessage;
                        if (editedRich && !editedRich.text) {
                            const decoded = (0, meta_ai_msmsg_1.decodeRichResponseMessage)(editedRich);
                            if (decoded)
                                editedRich.text = decoded;
                        }                        
                    }
                    catch (err) {
                        logger.error({ key: fullMessage.key, err }, 'failed to decrypt message');
                        fullMessage.messageStubType = WAProto_1.proto.WebMessageInfo.StubType.CIPHERTEXT;
                        fullMessage.messageStubParameters = [err.message];
                    }
                }
            }
            // if nothing was found to decrypt
            if (!decryptables) {
                fullMessage.messageStubType = WAProto_1.proto.WebMessageInfo.StubType.CIPHERTEXT;
                fullMessage.messageStubParameters = [exports.NO_MESSAGE_FOUND_ERROR_TEXT];
            }
        }
    };
};
exports.decryptMessageNode = decryptMessageNode;
