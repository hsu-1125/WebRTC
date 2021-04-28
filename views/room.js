const isO2O = document.querySelector("#mode").textContent === '1'; //是否為一對一
const roomID = document.querySelector("#roomID").textContent;
const userID = document.querySelector("#userID").textContent;
const targetID = document.querySelector("#targetID").textContent;
const identity = document.querySelector("#identity").textContent;
const startedIdSet = new Set();
const CallStatusEnum = Object.freeze({ "Calling": 1, "Incoming": 2, "Dialing": 3, "NoReply": 4 });
const socket = io(
    "http://localhost:3001", 
    { 'reconnection': false, 'autoConnect': false }
);

// 影片相關元件
const video_local = document.querySelector('#localVideo');
const video_large = document.querySelector('.largeVideo');
const videoContainer = document.querySelector('#videoContainer');
// 管理按鈕的區塊
const callingBtns = document.querySelector('#callingBtns');
const dialingBtns = document.querySelector('#dialingBtns');
const incomingBtns = document.querySelector('#incomingBtns');
// 撥打中、來電中會使用的按鈕
const btn_cancel = document.querySelector('#cancelBtn');
const btn_reject = document.querySelector('#rejectBtn');
const btn_join = document.querySelector('#joinBtn');
// 通話中會使用的按鈕
const btn_audio = document.querySelector('#audioBtn');
const btn_video = document.querySelector('#videoBtn');
const btn_screenShare = document.querySelector('#screenShareBtn');
const btn_hangUp = document.querySelector('#hangUpBtn');
// 其他元件
const roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#dialog'));
const snackbar = new mdc.snackbar.MDCSnackbar(document.querySelector('.mdc-snackbar'));
const text_targetMsg = document.querySelector("#targetMsg");

let peer = null;
let callStatus = null; //儲存目前通話狀態
let pc = null;
let localStream = null;
let lastVideoReport = null;
let videoBitrate = null;
let oneSecTimer = null;
let tenSecTimer = null;
let noReplyTimer = null;

function init() {
    console.log('裝置資訊：', navigator.userAgent);

    if (isMobileDevice()) {
        btn_screenShare.style.display = "none";
    }

    if (isO2O) {
        callingBtns.hidden = true;
        dialingBtns.hidden = identity === 'joiner';
        incomingBtns.hidden = identity === 'creator';
        
        text_targetMsg.hidden = false;
        text_targetMsg.textContent = (identity === 'creator') ? `撥打給 ${targetID}` : `${targetID} 來電`;
    } else {
        callingBtns.hidden = false;
        dialingBtns.hidden = true;
        incomingBtns.hidden = true;
    }

    if (identity === 'creator') {
        initCreator();
    } else if (identity === 'joiner') {
        initJoiner();
    }
}

function isMobileDevice() {
    const mobileDevice = ['Android', 'webOS', 'iPhone', 'iPad', 'iPod', 'BlackBerry', 'Windows Phone']
    let isMobileDevice = mobileDevice.some(e => navigator.userAgent.match(e))
    return isMobileDevice
}

async function getMedia() {
    const constraints = {};
    constraints.audio = true;
    constraints.video = { frameRate: { ideal: 30, min: 24 } };

    if (!navigator.mediaDevices) { 
        hangUp("您的裝置、平台版本不支援網路通話", true);
    } else {
        localStream = await navigator.mediaDevices
            .getUserMedia(constraints)
            .catch(msg => hangUp(msg, true));

        video_local.srcObject = localStream;
        video_local.onplay = () => {
            if (window.AndroidWebView) {
                window.AndroidWebView.onLocalReady();
            } else if (window.webkit) {
                window.webkit.messageHandlers.onLocalReady.postMessage("");
            }
        }

        handleMultiPlatformVideoPlay("localVideo");
    }

    return (localStream !== undefined);
}

function handleMultiPlatformVideoPlay(id) {
    if (window.AndroidWebView) {
        window.AndroidWebView.onVideoInitialized(id);
    } else if (window.webkit) {
        window.webkit.messageHandlers.onVideoInitialized.postMessage(id);
    }
}

function playVideo(id) {
    document.querySelector(`#${id}`).play();
}

function setButtonListener() {
    //撥打的按鈕事件
    btn_cancel.addEventListener('click', () => {
        hangUp("您已取消通話", false);
    });

    //被撥打的按鈕事件
    btn_reject.addEventListener('click', () => {
        hangUp("您已拒絕通話", false);
    });

    btn_join.addEventListener('click', () => {
        clearTimeout(noReplyTimer);
        initJoinerPeer();
        callingBtns.hidden = false;
        incomingBtns.hidden = true;
        text_targetMsg.hidden = true;
        socket.emit('join', roomID, userID);
    });

    //通話中的按鈕事件
    btn_audio.addEventListener('click', () => {
        const isOpen = btn_audio.classList.contains('active');
        toggleTracks(true, !isOpen);
    });

    btn_video.addEventListener('click', () => {
        const isOpen = btn_video.classList.contains('active');
        toggleTracks(false, !isOpen);
    });

    btn_screenShare.addEventListener('click', () => {
        const isOpen = btn_screenShare.classList.contains('active');
        toggleShareScreen(!isOpen);
    });

    btn_hangUp.addEventListener('click', () => {
        hangUp("通話已結束", false);
    });
}

function setNoReplyTimer() {
    console.log('noReplyTimer start')
    noReplyTimer = setTimeout(() => {
        callStatus = CallStatusEnum.NoReply
        hangUp((identity === 'joiner') ? "您錯過了一通電話" : "對方未回應", true);
    }, (identity === 'joiner') ? 10000 : 20000);
}

function showMsg(text) {
    snackbar.labelText = text;
    snackbar.open();
}

function toggleTracks(isAudio, enable) {
    if (isAudio) {
        localStream.getAudioTracks().forEach(track => {
            console.log('track kind:' + track.kind);
            console.log('track label:' + track.label);
            track.enabled = enable;
        });

        document.querySelector('#audioBtn').classList.toggle('active', enable);
        document.querySelector('#audioBtnImg').innerHTML = (enable) ? "mic" : "mic_off"
    }
    else {
        localStream.getVideoTracks().forEach(track => {
            console.log('track kind:' + track.kind);
            console.log('track label:' + track.label);
            track.enabled = enable;
        });

        document.querySelector('#videoBtn').classList.toggle('active', enable);
        document.querySelector('#videoBtnImg').innerHTML = (enable) ? "videocam" : "videocam_off"
    }
}

async function toggleShareScreen(enable) {
    async function showCameraView() {
        const constraints = {};
        constraints.video = { frameRate: { ideal: 30, min: 24 } };

        const stream = await navigator.mediaDevices
            .getUserMedia(constraints)
            .catch(msg => hangUp(msg, true));

        if (stream) {
            showMsg('停止螢幕分享');
            const videoTrack = stream.getVideoTracks()[0];
            console.log(`Using video device: ${videoTrack.label}`);

            localStream.getVideoTracks().forEach(track => {
                track.stop();
                localStream.removeTrack(track);
            });
            localStream.addTrack(videoTrack);

            if (pc) {
                const senderVideo = pc.getSenders().find(sender => sender.track.kind === 'video');
                senderVideo.replaceTrack(videoTrack);
                document.querySelector(`#${userID}`).classList.toggle('mirror', true);
            }

            video_local.classList.toggle('mirror', true); 
            document.querySelector('#videoBtn').classList.toggle('active', true);
            document.querySelector('#videoBtnImg').innerHTML = "videocam"
            document.querySelector('#screenShareBtn').classList.toggle('active', false);
            document.querySelector('#screenShareBtnImg').innerHTML = "stop_screen_share";
        }
    }

    if (enable) {
        const constraints = {};
        constraints.video = { frameRate: { ideal: 30 } };

        const stream = await navigator.mediaDevices
            .getDisplayMedia(constraints)
            .catch(showMsg);

        if (stream) {
            const videoTrack = stream.getVideoTracks()[0];
            console.log(`Using video device: ${videoTrack.label}`);

            videoTrack.addEventListener('ended', async () => {
                await showCameraView();
            });

            localStream.getVideoTracks().forEach(track => {
                track.stop();
                localStream.removeTrack(track);
            });
            localStream.addTrack(videoTrack);

            if (pc) {
                const senderVideo = pc.getSenders().find(sender => sender.track.kind === 'video');
                senderVideo.replaceTrack(videoTrack);
                document.querySelector(`#${userID}`).classList.toggle('mirror', false);
            }

            video_local.classList.toggle('mirror', false); 
            document.querySelector('#videoBtn').classList.toggle('active', true);
            document.querySelector('#videoBtnImg').innerHTML = "videocam"
            document.querySelector('#screenShareBtn').classList.toggle('active', true);
            document.querySelector('#screenShareBtnImg').innerHTML = "screen_share";
        }
    } else {
        await showCameraView();
    }
}

function initCreator() {
    socket.once('connected', async () => {
        console.log('receive connected');
        callStatus = isO2O ? CallStatusEnum.Dialing : CallStatusEnum.Calling;

        if (await getMedia()) {
            setButtonListener();

            if (isO2O) {
                setNoReplyTimer();
            }

            peer = new Peer(userID);
            console.log('peer', peer);
            socket.emit('create', roomID, userID, (isO2O) ? targetID : null);
        }
    });

    socket.once('noReply', () => {
        console.log('receive noReply');
        showEndDialog("對方未回應", 0);
    });

    socket.once('reject', () => {
        console.log('receive reject');
        showEndDialog("對方已拒絕通話", 0);
    });

    socket.once('busy', () => {
        console.log('receive busy');
        showEndDialog("對方正在通話中", 0);
    });

    socket.once('created', () => {
        console.log('receive created');
        showEndDialog("您已使用其他裝置進行通話", 0);
    });

    socket.on('start', (targetID) => {
        console.log('receive start');

        if (isO2O) {
            clearTimeout(noReplyTimer);
            callStatus = CallStatusEnum.Calling;
            callingBtns.hidden = false;
            dialingBtns.hidden = true;
            text_targetMsg.hidden = true;
        }

        const call = peer.call(targetID, localStream);
        const conn = peer.connect(targetID);

        console.log('targetID', targetID);
        console.log('call', call);

        call.on('stream', (remoteStream) => {
            if (startedIdSet.has(targetID)) {
                return
            } else {
                startedIdSet.add(targetID)
            }

            if (videoContainer.childElementCount === 0) {
                video_local.srcObject = null;
                addVideo(userID, localStream);
            }

            if (!video_large.srcObject) {
                video_large.id = targetID;
                video_large.srcObject = remoteStream;
                handleMultiPlatformVideoPlay(targetID);
            } else {
                addVideo(targetID, remoteStream);
            }

            showMsg(`${targetID} 加入房間`);
            pc = call.peerConnection;
            //setLowBandwidth();
            getReport();
        });

        conn.on('data', (data) => {
            if (data === 'low-bandwidth') {
                showMsg('對方的頻寬不足，已將視訊轉為音訊');
                toggleTracks(false, false);
            }
        });

        conn.on('open', () => {
            checkVideoBandwidth(conn);
        });
    });

    commonSocketListener();
}

function initJoiner() {
    socket.once('connected', async () => {
        console.log('receive connected');

        if (isO2O) {
            socket.emit('sign', roomID, userID);
            callStatus = CallStatusEnum.Incoming;
            setNoReplyTimer();

            if (await getMedia()) {
                setButtonListener();
            }
        } else {
            if (await getMedia()) {
                callStatus = CallStatusEnum.Calling;
                setButtonListener();
                initJoinerPeer();
                socket.emit('join', roomID, userID);
            }
        }
    });

    socket.once('cancel', () => {
        console.log('receive cancel');
        showEndDialog("對方已取消通話", 0);
    });

    socket.once('finished', () => {
        console.log('receive finished');
        showEndDialog(isO2O ? "通話已被取消" : "通話已在先前結束", 500);
    });

    socket.once('joined', () => {
        console.log('receive joined');
        showEndDialog("您已進行通話", 500);
    });

    socket.once('rejected', () => {
        console.log('receive rejected');
        showEndDialog("您已使用其他裝置拒絕通話", 0);
    });

    socket.on('start', (targetID) => {
        console.log('receive start');

        const call = peer.call(targetID, localStream);
        const conn = peer.connect(targetID);

        call.on('stream', (remoteStream) => {
            if (startedIdSet.has(targetID)) {
                return;
            } else {
                startedIdSet.add(targetID);
            }

            if (videoContainer.childElementCount === 0) {
                video_local.srcObject = null;
                addVideo(userID, localStream);
            }

            if (!video_large.srcObject) {
                video_large.id = targetID;
                video_large.srcObject = remoteStream;
                handleMultiPlatformVideoPlay(targetID);
            } else {
                addVideo(targetID, remoteStream);
            }

            showMsg(`${targetID} 加入房間`);
        });

        conn.on('data', (data) => {
            if (data === 'low-bandwidth') {
                showMsg('對方的頻寬不足，已將視訊轉為音訊');
                toggleTracks(false, false);
            }
        });

        conn.on('open', () => {
            checkVideoBandwidth(conn);
        });
    });

    commonSocketListener();
}

function initJoinerPeer() {
    peer = new Peer(userID);
    console.log('peer', peer);

    peer.on('call', (call) => {
        const targetID = call.peer;
        console.log(`${targetID} call me`);

        if (isO2O) {
            callStatus = CallStatusEnum.Calling;
        }

        call.answer(localStream);
        call.on('stream', (remoteStream) => {
            if (startedIdSet.has(targetID)) {
                return;
            } else {
                startedIdSet.add(targetID);
            }

            if (videoContainer.childElementCount === 0) {
                video_local.srcObject = null;
                addVideo(userID, localStream);
                showMsg('已加入通話');
            }

            if (!video_large.srcObject) {
                video_large.id = targetID;
                video_large.srcObject = remoteStream;
                handleMultiPlatformVideoPlay(targetID);
            } else {
                addVideo(targetID, remoteStream);
            }

            pc = call.peerConnection;
            getReport();
        });
    });

    peer.on('connection', (conn) => {
        conn.on('data', (data) => {
            if (data === 'low-bandwidth') {
                showMsg('對方的頻寬不足，已將視訊轉為音訊');
                toggleTracks(false, false);
            }
        });
        conn.on('open', () => {
            checkVideoBandwidth(conn);
        });
    });
}

function commonSocketListener() {
    socket.on('leave', (targetID) => {
        startedIdSet.delete(targetID);

        if (isO2O) {
            showEndDialog("通話已結束", 0);
        } else {
            showMsg(`${targetID} 離開通話`);
            const count = videoContainer.children.length;

            if (count === 1) { 
                video_local.srcObject = localStream;
                video_large.srcObject = null;
                videoContainer.children[0].remove();
            } else { 
                if (video_large.id === targetID) { 
                    const video = videoContainer.children[1];
                    video_large.id = video.id;
                    video_large.srcObject = video.srcObject;
                    video.remove();
                } else {
                    document.querySelector(`#${targetID}`).remove();
                }
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('disconnect');
        release();
    });

    socket.connect();
}

function addVideo(id, stream) {
    const video = document.createElement('video');
    video.id = id
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;

    if (id === userID) {
        video.muted = true;
        video.classList.add('local');

        if (!document.querySelector('#screenShareBtn').classList.contains('active')) {
            video.classList.add('mirror');
        }
    } else {
        video.addEventListener('click', () => {
            const largeId = video_large.id;
            const largeStream = video_large.srcObject;
            
            video_large.id = video.id;
            video_large.srcObject = video.srcObject;
            
            video.id = largeId;
            video.srcObject = largeStream;
        });
    }

    videoContainer.appendChild(video);
    handleMultiPlatformVideoPlay(id);
}

function setLowBandwidth() {
    const senderVideo = pc.getSenders().find(sender => sender.track.kind === 'video');
    const parameters = senderVideo.getParameters();

    if (!parameters.encodings) {
        parameters.encodings = [{}];
    }

    parameters.encodings[0].maxBitrate = 125 * 1000;

    senderVideo.setParameters(parameters)
        .then(() => {
            console.log('parameters設定成功', parameters);
        })
        .catch(e => console.error(e));
}

function getReport() {
    clearInterval(oneSecTimer);

    oneSecTimer = setInterval(() => {
        const senderVideo = pc.getSenders().find(sender => sender.track.kind === 'video');

        senderVideo.getStats().then(res => {
            res.forEach(report => {
                if (report.type === 'outbound-rtp') {
                    if (report.isRemote) {
                        return;
                    }

                    const textBitrate = document.querySelector('#textVideoBitrate');
                    const textPackets = document.querySelector('#textVideoPackets');

                    const now = report.timestamp;
                    const bytes = report.bytesSent;
                    const packets = report.packetsSent;

                    if (lastVideoReport && lastVideoReport.has(report.id)) {
                        videoBitrate = Math.round(
                            8 * (bytes - lastVideoReport.get(report.id).bytesSent) /
                            (now - lastVideoReport.get(report.id).timestamp)
                        );
                        const packet = (packets - lastVideoReport.get(report.id).packetsSent);

                        textBitrate.innerHTML = `<strong>VideoBitrate:</strong>${videoBitrate} kbits/sec`;
                        textPackets.innerHTML = `<strong>VideoPackets:</strong>${packet} (Total:${packets})`;
                    }
                }
            });
            lastVideoReport = res;
        });
    }, 1000);
}

function checkVideoBandwidth(conn) {
    console.log('conn', conn);
    clearInterval(tenSecTimer);

    tenSecTimer = setInterval(() => {
        const count = videoContainer.children.length;
        if (pc && count > 0) {
            const isOpen = btn_video.classList.contains('active');
            console.log('檢測頻寬');
            if (videoBitrate < 150) {
                if (isOpen) {
                    showMsg('你的頻寬不足，已將視訊轉為音訊');
                    toggleTracks(false, false);

                    if (startedIdSet.size === 1) {
                        console.log('send conn', conn);
                        conn.send('low-bandwidth');
                    }
                }
            }
        }
    }, 10000);
}

function showEndDialog(msg, timeout) {
    document.querySelector('#dialogMsg').innerHTML = msg;
    roomDialog.listen('MDCDialog:closing', () => {
        showEndScreen(msg);
    });
    roomDialog.open();

    setTimeout(() => {
        release();
    }, timeout);
}

function showEndScreen(msg) { //關閉畫面
    if (window.AndroidWebView) {
        window.AndroidWebView.onFinish();
    } else if (window.webkit) {
        window.webkit.messageHandlers.onFinish.postMessage("");
    } else { //電腦
        document.querySelector("#endScreen").hidden = false;
        document.querySelector("#videos").hidden = true;
        document.querySelector("#endMsg").textContent = msg;
    }
}

function hangUp(msg, isDialog) {
    if (callStatus === CallStatusEnum.Calling) {
        socket.emit('leave', roomID, userID);
    } else if (callStatus === CallStatusEnum.Incoming) {
        socket.emit('reject', roomID, userID);
    } else if (callStatus === CallStatusEnum.Dialing) {
        socket.emit('cancel', roomID, userID, targetID);
    } else if (callStatus === CallStatusEnum.NoReply) {
        socket.emit((identity === 'joiner') ? 'noReply' : 'cancel', roomID, userID, targetID);
    }

    if (isDialog) {
        showEndDialog(msg, 100);
    } else {
        showEndScreen(msg);

        setTimeout(() => {
            release();
        }, 100);
    }
}

function release() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (socket) {
        socket.disconnect();
    }
    if (peer) {
        peer.destroy();
    }

    clearInterval(oneSecTimer);
    clearInterval(tenSecTimer);
    clearTimeout(noReplyTimer);
}

window.onbeforeunload = function () {
    hangUp("通話已結束", false);
};

init();