const express = require('express')
const Docker = require('dockerode');
const body_parser = require('body-parser')
const fs= require('fs');
const { exec } = require('child_process');
const docker = new Docker();
const { idgen } = require('./id_gen');
const { spawn } = require('child_process');
var AWS = require('aws-sdk');
var cors = require('cors')
const client = require('prom-client');
const collectDefaultMetrics = client.collectDefaultMetrics;
require('aws-sdk/lib/maintenance_mode_message').suppress = true;
require('dotenv').config()
 
const app = express()
app.use(cors())
const Registry = client.Registry;
const register = new Registry();
collectDefaultMetrics({ register });
app.use(body_parser.urlencoded({ extended: true }))
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.API_KEY);

const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
AWS.config.update({
    region: process.env.Region,
    accessKeyId: process.env.accessKeyId,
    secretAccessKey: process.env.secretAccessKey
});

    // Copy code file into Docker container
    function startDocker(id, callback) {
        const dockerStart = spawn('docker', ['start', id]);
    
        dockerStart.stderr.on('data', (data) => {
            console.error('Error starting Docker container:', data.toString());
            callback(data.toString(), null);
        });
    
        dockerStart.on('close', (code) => {
            if (code === 0) {
                const dockerUpdate = spawn('docker', ['update', '--memory', '100m', '--cpus', '1', id]);
                console.log('Docker container started');
                callback(null, 'Docker container started');
            }
        });
    }
    
    function executeDockerAndDelete(id, res, req) {
        let codeFile = '';
        let dockerExecCmd = '';
        const lang = req.body.lang;
    
        if (lang === 'c') {
            codeFile = `code.c`;
            dockerExecCmd = `docker exec ${id} sh -c "gcc -o code code.c && ./code"`;
        } else if (lang === 'py') {
            codeFile = `code.py`;
            dockerExecCmd = `docker exec ${id} python3 /usr/src/app/code.py`;
        } else if (lang === 'js') {
            codeFile = `code.js`;
            dockerExecCmd = `docker exec ${id} node /usr/src/app/code.js`;
            
        
        }
        else if(lang === 'go'){
            codeFile = `code.go`;
            dockerExecCmd = `docker exec ${id} sh -c "go run code.go"`;
        }
        else if (lang === 'rs'){
            codeFile = `code.rs`;
            dockerExecCmd = `docker exec ${id} sh -c "rustc code.rs && ./code"`;
        }
        // else if(lang === 'java'){
        //     codeFile = `code.java`;
        //     dockerExecCmd = `docker exec ${id} sh -c "javac code.java && java code"`;

        // }
        else if(lang==='cpp'){
            codeFile = `code.cpp`;
            dockerExecCmd = `docker exec ${id} sh -c "g++ -o code code.cpp && ./code"`;
        }
         else {
            res.status(400).send({ error: 'Unsupported language' });
            return;
        }
    
        exec(`docker cp ./${codeFile} ${id}:/usr/src/app`, (err, stdout, stderr) => {
            if (err) {
                console.error('Error copying code file:', err);
                res.status(500).send({ error: 'Error starting Docker container', details: err });
                return;
            }
            console.log('Code file copied successfully');
    
            // Start Docker container
            startDocker(id, (error, message) => {
                if (error) {
                    res.status(500).send({ error: 'Error starting Docker container', details: error });
                    return;
                }
    
                // Execute commands in Docker container
                exec(dockerExecCmd, (error, stdout, stderr) => {
                    if (error) {
                        console.error('Error compiling/executing:', error);
                        fs.unlink(codeFile, (err) => {
                            if (err) {
                                console.error('Error deleting code file:', err);
                                return;
                            }
                            console.log('Code file deleted successfully');
                        });
    
                        // Remove the Docker container
                        exec(`docker rm -f ${id}`, (error, stdout, stderr) => {
                            if (error) {
                                console.error('Error removing Docker container:', error);
                                return;
                            }
                            console.log('Docker container removed');
                        });
    
                        res.status(500).send({ error: 'Error compiling/executing', details: stderr });
                        return;
                    }
    
                    console.log('Code compiled and executed successfully');
                    const s3 = new AWS.S3();
                    const params = {
                        Bucket: 'codeplayground12332241242142142421',
                        Key: `${req.body.email}/${req.body.fname}.${lang}`,
                        Body: fs.createReadStream(`./${codeFile}`)
                    };
                    s3.upload(params, (err, data) => {
                        if (err) {
                            console.log('Error uploading file:', err);
                        } else {
                            console.log('File uploaded successfully. File location:', data.Location);
                            fs.unlink(codeFile, (err) => {
                                if (err) {
                                    console.error('Error deleting code file:', err);
                                    return;
                                }
                                console.log('Code file deleted successfully');
                            });
                        }
                    });
    
                    // Remove the Docker container
                    exec(`docker rm -f ${id}`, (error, stdout, stderr) => {
                        if (error) {
                            console.error('Error removing Docker container:', error);
                            return;
                        }
                        console.log('Docker container removed');
                    });
    
                    // Send response with stdout data
                    res.status(200).send({ out: stdout });
                });
            });
        });
    }


app.post('/compile', function (req, res){

    fs.writeFile(`code.${req.body.lang}`, req.body.code, (err) => {
        if (err) {
            console.error('Error writing code file:', err);
            res.status(500).send({ error: 'Error writing code file', details: err });
            return;
        }
        console.log('Code file saved!');
        var id=idgen(5)
       exec(`docker create -i --name ${id} comp`,(err)=>{
        if(err) {
            console.log("Error creating container")
        }

        
          
        

       
        executeDockerAndDelete(id, res ,req )

       })
      
       
})
})

    
app.get("/getCode",function(req,res){

    const s3 = new AWS.S3();
    const params = {
        Bucket: 'codeplayground12332241242142142421',
        //Prefix: `${req.params.email}` // Assuming email is used as the folder name
    };

    s3.listObjectsV2(params, (err, data) => {
        if (err) {
            console.log('Error fetching file list:', err);
            res.status(500).send({ error: 'Error fetching file list', details: err });
        } else {
            // Extract the file names from the data
            var fileNames = data.Contents.map(file => file.Key);
            var emailFiles=[]
            console.log('File names:', fileNames);
             for (var i=0;i<fileNames.length;i++){
                    if(fileNames[i].startsWith(req.query.email)){
                        const splitFileNames=fileNames[i].split("/")
                        emailFiles.push(splitFileNames[1])
                    }
             }
            res.status(200).send({ files: emailFiles });
        }
    });

})
app.get('/getCodeValue', function (req, res) {
    const s3 = new AWS.S3();

    const params = {
        Bucket: 'codeplayground12332241242142142421',
        Key: `${req.query.email}/${req.query.fname}`,
    };

    s3.getObject(params, (err, data) => {
        if (err) {
            console.error('Error reading from S3:', err);
            return res.status(500).send({
                error: 'Error fetching the file',
                details: err.message,
            });
        }

        try {
            // Convert file content to a string
            const fileContent = data.Body.toString('utf-8');

            // Send the content as JSON
            res.json({
                success: true,
                content: fileContent,
            });
        } catch (conversionError) {
            console.error('Error processing file content:', conversionError);
            res.status(500).send({
                error: 'Error processing file content',
                details: conversionError.message,
            });
        }
    });
});

app.post("/codeAi",async function(req,res){

    const result = await model.generateContent([req.body.prompt]);
    res.send(result.response.text());

})
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.send(metrics);
  
})
app.listen(8000,()=>{
console.log('listening on 8000')
})

