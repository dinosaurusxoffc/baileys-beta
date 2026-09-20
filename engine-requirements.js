const major = parseInt(process.versions.node.split(".")[0], 10);
if (major < 20) {
  console.error(
    `\n❌𝙾𝙾𝙿𝚂 𝚅𝙴𝚁𝚂𝙸 𝙽𝙾𝙳𝙴.𝙹𝚂 𝙺𝙰𝙼𝚄 𝚃𝙴𝚁𝙻𝙰𝙻𝚄 𝙻𝙰𝚆𝙰𝚂...\n` +
      `   𝙳𝙸𝙿𝙴𝚁𝙻𝚄𝙺𝙰𝙽: 𝙽𝙾𝙳𝙴.𝙹𝚂 𝚅𝟸𝟶 𝙰𝚃𝙰𝚄 𝙻𝙴𝙱𝙸𝙷 𝚃𝙸𝙽𝙶𝙶𝙸\n` +
      `   𝚂𝙰𝙰𝚃 𝙸𝙽𝙸: 𝚅${process.versions.node}\n\n` +
      `   𝚇- 𝙳𝙸𝙽𝙾 𝚇 𝙾𝙵𝙵𝙸𝙲𝙸𝙰𝙻\n`
  );
  process.exit(1);
}
