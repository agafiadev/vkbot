import {readFileSync} from 'fs'
import {MongoClient} from "mongodb"
import {API, Upload, Updates, Attachment, Keyboard, resolveResource} from 'vk-io'

const owner_id = parseInt(process.env.PUBLIC),
    mongo = await MongoClient.connect(process.env.MONGODB),
    appAPI = new API({token: process.env.TOKEN2, apiLimit: 20}),
    publicAPI = new API({token: process.env.TOKEN, apiLimit: 20}),
    users = mongo.db('Vezdekod').collection('Users'),
    cards = JSON.parse(readFileSync('data/cards.json').toString()),
    userDefaults = {cards: [], currentCards: [], currentWord: null, score: 0, album: null},
    buttons = {start: Keyboard.textButton({label: 'Старт', color: Keyboard.POSITIVE_COLOR})}

export default new Updates({api: publicAPI, upload: new Upload({api: publicAPI})})
    .on('message_new', async context => {
        const user = context.state.user = await fetchUser(context.senderId);
        const album = context.state.user?.album || cards;
        switch (context.text?.trim().toLowerCase()) {
            case 'начать':
            case 'старт':
                await updateUser(user, userDefaults)
                return await riddleCards(context)
            default:
                const resource = await resolveResource({api: appAPI, resource: context.text?.trim()})
                if (resource?.type === 'album') return await switchAlbum(context, resource)
                if (!context.state.user?.currentWord) return await context.send('Отправьте слово "Старт" чтобы получить изображения', {keyboard: Keyboard.keyboard([buttons.start]).oneTime()})
                const isCorrect = checkWordInCard(context.state.user.currentWord, Object.keys(album)[parseInt(context.text?.trim()) - 1], album)
                if (isCorrect) {
                    await updateUser(user, {score: user.score += 3})
                    await context.send(`Верно 🎉\r\nВаш счет: ${user.score || 0}`)
                } else await context.send(`Не верно 🙄\r\nВаш счет: ${user.score || 0}`)
                return await riddleCards(context)
        }
    });

async function riddleCards(context) {
    if (!context.state.user?.album) context.state.user.album = cards;
    const album = context.state.user.album;
    const owner_id = context.state.user.owner_id || owner_id;
    const remainCards = getRemainCards(Object.keys(album), context.state.user),
        currentCards = getRandomItemsFromArray(remainCards, 5),
        uniqWords = getUniqWordsForCards(currentCards, album),
        currentWord = getRandomItemsFromArray(uniqWords, 1).pop(),
        attachment = currentCards.map(id => new Attachment({api: publicAPI, type: 'photo', payload: {id, owner_id}})),
        keyboard = Keyboard.keyboard([currentCards.map(card => Keyboard.textButton({label: (Object.keys(album).indexOf(card) + 1).toString()})), buttons.start]).oneTime()
    if (!currentCards.length) return await context.send('Карты закончились 😢 — отправьте Старт чтобы начать заново', {keyboard: Keyboard.keyboard([buttons.start]).oneTime()})
    await Promise.all([
        context.send('', {attachment}),
        appendUserCards(context.state.user, currentCards),
        updateUser(context.state.user, {currentWord, currentCards})
    ])
    return await context.send(`Укажите номер карточки, которая связана со словом: ${currentWord}`, {keyboard})
}

function getRandomItemsFromArray(array, count) {
    return array.sort(() => 0.5 - Math.random()).slice(0, count)
}

async function fetchUser(id) {
    const data = await users.findOne({id})
    return {...data || userDefaults, id}
}

async function updateUser({id} = {}, data) {
    return await users.updateOne({id}, {$set: data}, {upsert: true})
}

function getRemainCards(allCards = [], {cards = []} = {}) {
    if (!Array.isArray(cards)) cards = [];
    return allCards.filter(card => !cards.includes(card))
}

function appendUserCards({id, cards = []} = {}, newCards = []) {
    const uniqCards = new Set([...Array.isArray(cards) ? cards : [], ...newCards])
    return updateUser({id}, {cards: [...uniqCards]})
}

function getCardWords(card, album) {
    const text = typeof album[card] == 'object' && album[card]?.text ? album[card].text : album[card].toString()
    return text?.trim()?.toLowerCase()?.split(' ')?.filter(Boolean)
}

function getUniqWordsForCards(targetCards = [], album) {
    const allWords = targetCards.flatMap(card => getCardWords(card, album)),
        countWords = allWords.reduce((cnt, cur) => (cnt[cur] = cnt[cur] + 1 || 1, cnt), {})
    return Object.entries(countWords).filter(([word, count]) => count === 1).map(([word, count]) => word)
}

function checkWordInCard(word, card, album) {
    const words = getCardWords(card, album) || []
    return words.includes(word)
}

async function switchAlbum(context, {id: album_id, ownerId: owner_id} = {}) {
    const album = await appAPI.photos.get({album_id, owner_id});
    if (!album?.count) return context.send('В переданном альбоме нет фотографий, отправьте Старт чтобы начать игру', {keyboard: Keyboard.keyboard([buttons.start]).oneTime()})
    await updateUser(context.state.user, {
        ...userDefaults,
        album_id,
        owner_id,
        album: Object.fromEntries(album.items.map(item => [item.id, item]))
    })
    context.state.user = await fetchUser(context.state.user.id)
    await context.send(`Альбом успешно подключен, количество карточек: ${album?.count || 0}`)
    return await riddleCards(context)
}
