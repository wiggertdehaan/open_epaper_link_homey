
class TagManager {

    // constructor
    constructor(homey)
    {
        this.homey = homey; 
        this.homey.log('TagManager constructor');     
        //this.log('Tag constructor');
    }

    // update tags
    updateTags(tags)
    {
        tags.forEach(tag => {
            //this.updateHomeyTag([tag]);
            this.homey.log('updating Tag '+tag.mac);
        }); 
    }




}

module.exports = TagManager;